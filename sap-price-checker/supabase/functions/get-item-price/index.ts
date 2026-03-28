/**
 * Supabase Edge Function: get-item-price
 *
 * GET /functions/v1/get-item-price?search=laptop
 * GET /functions/v1/get-item-price?itemCode=A00001
 *
 * Required headers:
 *   x-sap-session   — SAP B1 SessionId
 *   x-sap-company   — SAP company database name
 *
 * Strategy for last-sold price:
 *   SAP Service Layer v2 does not support OData lambda (any/all) filters on
 *   navigation properties. Instead we fetch the 50 most recent invoices in one
 *   request, build an in-memory map of ItemCode → last sold info, and join
 *   it against the items returned from the Items endpoint.
 *
 * Environment secrets (set via `supabase secrets set`):
 *   SAP_SERVICE_LAYER_URL
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sap-session, x-sap-company',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Currency normaliser ───────────────────────────────────────────────────────
const CURRENCY_MAP: Record<string, string> = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
  '₹': 'INR', '₩': 'KRW', 'A$': 'AUD', 'C$': 'CAD',
}
function normCurrency(raw: string | undefined): string {
  if (!raw) return 'USD'
  if (CURRENCY_MAP[raw]) return CURRENCY_MAP[raw]
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SAPItemPrice { PriceList: number; Price: number; Currency: string }
interface SAPItem { ItemCode: string; ItemName: string; ItemPrices?: SAPItemPrice[] }
interface SAPDocLine { ItemCode: string; Price: number; Currency?: string; DiscountPercent?: number }
interface SAPInvoice { DocDate: string; DocumentLines: SAPDocLine[] }

interface LastSoldInfo { price: number; currency: string; discount: number | null }
interface PriceResult {
  itemCode: string; itemName: string; price: number
  lastSoldPrice: number | null; discount: number | null
  priceListName: string; currency: string
}

// ─────────────────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  // ── Validate headers ────────────────────────────────────────────────────────
  const sapSession = req.headers.get('x-sap-session')
  const sapCompany = req.headers.get('x-sap-company')
  if (!sapSession || !sapCompany) {
    return json({ error: 'missing_sap_headers', message: 'x-sap-session and x-sap-company are required' }, 400)
  }

  const url       = new URL(req.url)
  const itemCode  = url.searchParams.get('itemCode')?.trim() || null
  const search    = url.searchParams.get('search')?.trim()   || null
  if (!itemCode && !search) {
    return json({ error: 'missing_params', message: 'Provide itemCode or search' }, 400)
  }

  const sapBase = Deno.env.get('SAP_SERVICE_LAYER_URL')
  if (!sapBase) return json({ error: 'config_error', message: 'SAP_SERVICE_LAYER_URL not set' }, 500)

  // SAP auth via session cookie
  const sapHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: `B1SESSION=${sapSession}; CompanyDB=${encodeURIComponent(sapCompany)}`,
  }

  // Supabase client for cache writes
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ── Step 1: Fetch matching items from SAP ───────────────────────────────────
  const filter = itemCode
    ? `ItemCode eq '${itemCode.replace(/'/g, "''")}'`
    : (() => {
        const s = search!.replace(/'/g, "''")
        return `startswith(ItemCode,'${s}') or contains(ItemName,'${s}')`
      })()

  let itemsRes: Response
  try {
    itemsRes = await fetch(
      `${sapBase}/b1s/v2/Items?$filter=${encodeURIComponent(filter)}&$select=ItemCode,ItemName,ItemPrices&$top=10`,
      { headers: sapHeaders }
    )
  } catch {
    return json({ error: 'sap_unreachable' }, 502)
  }

  if (itemsRes.status === 401) return json({ error: 'session_expired' }, 401)
  if (!itemsRes.ok) {
    const t = await itemsRes.text().catch(() => '')
    return json({ error: 'sap_error', message: `Items query failed: ${itemsRes.status} ${t}` }, 502)
  }

  const sapItems: SAPItem[] = (await itemsRes.json()).value ?? []
  if (sapItems.length === 0) return json(itemCode ? null : [], 200)

  // ── Step 2: Fetch price list names (cache per run) ─────────────────────────
  const plNameCache = new Map<number, string>()
  async function getPLName(listNo: number): Promise<string> {
    if (plNameCache.has(listNo)) return plNameCache.get(listNo)!
    try {
      const r = await fetch(
        `${sapBase}/b1s/v2/PriceLists(${listNo})?$select=PriceListNo,PriceListName`,
        { headers: sapHeaders }
      )
      if (r.ok) {
        const d = await r.json()
        const name = d.PriceListName ?? `Price List ${listNo}`
        plNameCache.set(listNo, name)
        return name
      }
    } catch { /* non-critical */ }
    const fallback = `Price List ${listNo}`
    plNameCache.set(listNo, fallback)
    return fallback
  }

  // ── Step 3: Fetch last 50 invoices once, build ItemCode → last-sold map ─────
  //   SAP v2 does not support OData any() on navigation properties, so we
  //   fetch recent invoices in bulk and search DocumentLines in code.
  const lastSoldMap = new Map<string, LastSoldInfo>()

  try {
    // Collect the item codes we need to look up
    const neededCodes = new Set(sapItems.map(i => i.ItemCode))

    // Page through invoices (up to 3 pages × 20 = 60 invoices) until all
    // needed codes are found or pages are exhausted.
    let skip = 0
    const pageSize = 20
    let pagesLeft = 3

    while (pagesLeft > 0 && neededCodes.size > lastSoldMap.size) {
      const invRes = await fetch(
        `${sapBase}/b1s/v2/Invoices` +
        `?$select=DocDate,DocumentLines` +
        `&$orderby=DocDate desc` +
        `&$top=${pageSize}&$skip=${skip}`,
        { headers: sapHeaders }
      )

      if (invRes.status === 401) {
        // Session expired — we'll still return items without last-sold data
        break
      }

      if (!invRes.ok) break

      const payload = await invRes.json()
      const invoices: SAPInvoice[] = payload.value ?? []
      if (invoices.length === 0) break

      for (const inv of invoices) {
        for (const line of inv.DocumentLines ?? []) {
          const code = line.ItemCode
          if (neededCodes.has(code) && !lastSoldMap.has(code)) {
            lastSoldMap.set(code, {
              price:    line.Price ?? 0,
              currency: normCurrency(line.Currency),
              discount: line.DiscountPercent ?? null,
            })
          }
        }
      }

      // If page returned fewer than pageSize we've reached the end
      if (invoices.length < pageSize) break
      skip += pageSize
      pagesLeft--
    }
  } catch (e) {
    // Non-fatal — proceed without last-sold data
    console.warn('Last-sold lookup failed:', e)
  }

  // ── Step 4: Build results ───────────────────────────────────────────────────
  const results: PriceResult[] = await Promise.all(
    sapItems.map(async (item): Promise<PriceResult> => {
      const prices = item.ItemPrices ?? []
      const primary =
        prices.find(p => p.PriceList === 1 && p.Price > 0) ??
        prices.find(p => p.Price > 0) ??
        prices[0] ?? null

      const price         = primary?.Price ?? 0
      const rawCurrency   = primary?.Currency ?? '$'
      const currency      = normCurrency(rawCurrency)
      const priceListNum  = primary?.PriceList ?? 1
      const priceListName = await getPLName(priceListNum)

      const sold = lastSoldMap.get(item.ItemCode) ?? null

      const result: PriceResult = {
        itemCode:      item.ItemCode,
        itemName:      item.ItemName,
        price,
        lastSoldPrice: sold?.price ?? null,
        discount:      sold?.discount ?? null,
        priceListName,
        currency,
      }

      // Async cache write — fire and forget
      db.from('price_cache').upsert({
        item_code:       result.itemCode,
        item_name:       result.itemName,
        price:           result.price,
        last_sold_price: result.lastSoldPrice,
        discount:        result.discount,
        price_list_name: result.priceListName,
        currency:        result.currency,
        updated_at:      new Date().toISOString(),
      }, { onConflict: 'item_code' }).then(({ error }) => {
        if (error) console.warn('Cache write failed:', error.message)
      })

      return result
    })
  )

  return json(itemCode && results.length === 1 ? results[0] : results)
})
