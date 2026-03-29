/**
 * Dual-Mode Authentication & API Layer
 *
 * Mode A — Inside SAP Web Client:
 *   → Calls /b1s/v2/* DIRECTLY (same-origin, bypasses CSP)
 *   → No Supabase needed for API calls
 *   → Supabase info shown for reference only
 *
 * Mode B — Standalone (Netlify / localhost):
 *   → Calls Supabase Edge Functions which proxy to SAP
 *   → Full Supabase integration
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'

// ── Environment detection ─────────────────────────────────────────────────
export function isInsideSAPWebClient() {
  try {
    const url = window.location.href
    if (url.includes('/extn/') || url.includes('/webclient/') || url.includes('/ui-static/')) return true
    if (window?.sap?.b1?.context) return true
    if (window?.parent?.sap?.b1?.context) return true
  } catch { /* cross-origin */ }
  return false
}

/**
 * Test if Supabase is reachable (CSP may block it inside Web Client).
 * If the meta CSP tag works, this will succeed.
 */
async function canReachSupabase() {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${supabaseAnonKey}` },
      signal: AbortSignal.timeout(3000),
    })
    return true // any response (even 404) means Supabase is reachable
  } catch {
    return false // CSP blocked or network error
  }
}

// ── Currency normalizer ───────────────────────────────────────────────────
const CURRENCY_MAP = { '$':'USD','€':'EUR','£':'GBP','¥':'JPY','₹':'INR' }
function normCurrency(raw) {
  if (!raw) return 'USD'
  if (CURRENCY_MAP[raw]) return CURRENCY_MAP[raw]
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD'
}

// ── SSO Detection ─────────────────────────────────────────────────────────
export async function getOrCreateSession() {
  const insideWebClient = isInsideSAPWebClient()

  // Try SSO context
  const ctxGetters = [() => window?.sap?.b1?.context, () => window?.parent?.sap?.b1?.context]
  for (const getCtx of ctxGetters) {
    try {
      const ctx = getCtx()
      if (ctx?.sessionToken && ctx?.companyDB) {
        return {
          mode: 'webclient',
          sapSession: { sessionToken: ctx.sessionToken, companyDB: ctx.companyDB },
          username: ctx.username ?? ctx.userName ?? 'SSO User',
          useDirectAPI: true,
        }
      }
    } catch { /* ignore */ }
  }

  // If inside webclient but no SSO context, check if Supabase is reachable
  // (the meta CSP tag in index.html should whitelist *.supabase.co)
  if (insideWebClient) {
    const supabaseOk = await canReachSupabase()
    return {
      mode: 'webclient',
      sapSession: null,
      username: null,
      useDirectAPI: !supabaseOk,  // prefer Supabase if reachable, else fall back to direct
    }
  }

  return null // Show login form (standalone mode)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LOGIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function loginDirect(username, password, companyDB) {
  // Direct call to SAP Service Layer (same-origin inside Web Client)
  const sapBase = window.location.origin
  const res = await fetch(`${sapBase}/b1s/v2/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UserName: username, Password: password, CompanyDB: companyDB }),
    credentials: 'include',
  })

  if (res.status === 401 || res.status === 400) throw new Error('invalid_credentials')
  if (!res.ok) throw new Error(`SAP login failed (HTTP ${res.status})`)

  const data = await res.json()
  return {
    mode: 'webclient',
    sapSession: { sessionToken: data.SessionId, companyDB },
    username,
    useDirectAPI: true,
  }
}

export async function loginViaSupabase(username, password, companyDB) {
  // Via Supabase Edge Function (standalone mode)
  const { data, error } = await supabase.functions.invoke('sap-login', {
    body: { username, password, companyDB },
  })
  if (error) {
    const status = error?.context?.status ?? error?.status ?? 0
    if (status === 401) throw new Error('invalid_credentials')
    throw new Error(error.message ?? 'Login failed.')
  }
  if (!data?.sessionToken) throw new Error('No session token returned.')

  return {
    mode: 'standalone',
    sapSession: { sessionToken: data.sessionToken, companyDB: data.companyDB ?? companyDB },
    username,
    useDirectAPI: false,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function searchItems(query, session) {
  if (session.useDirectAPI) {
    return searchDirect(query, session)
  }
  return searchViaSupabase(query, session)
}

async function searchDirect(query, session) {
  const sapBase = window.location.origin
  const safe = query.replace(/'/g, "''")
  const filter = `startswith(ItemCode,'${safe}') or contains(ItemName,'${safe}')`

  const headers = {
    'Content-Type': 'application/json',
    Cookie: `B1SESSION=${session.sapSession.sessionToken}; CompanyDB=${encodeURIComponent(session.sapSession.companyDB)}`,
  }

  // Fetch items
  const itemsRes = await fetch(
    `${sapBase}/b1s/v2/Items?$filter=${encodeURIComponent(filter)}&$select=ItemCode,ItemName,ItemPrices&$top=10`,
    { headers, credentials: 'include' }
  )
  if (itemsRes.status === 401) throw new Error('session_expired')
  if (!itemsRes.ok) throw new Error(`Items query failed (${itemsRes.status})`)

  const sapItems = (await itemsRes.json()).value ?? []
  if (sapItems.length === 0) return []

  // Price list name cache
  const plCache = new Map()
  async function getPL(num) {
    if (plCache.has(num)) return plCache.get(num)
    try {
      const r = await fetch(`${sapBase}/b1s/v2/PriceLists(${num})?$select=PriceListNo,PriceListName`, { headers, credentials: 'include' })
      if (r.ok) { const d = await r.json(); const n = d.PriceListName ?? `PL ${num}`; plCache.set(num, n); return n }
    } catch {}
    const fb = `Price List ${num}`; plCache.set(num, fb); return fb
  }

  // Last sold lookup
  const lastSoldMap = new Map()
  const needed = new Set(sapItems.map(i => i.ItemCode))
  try {
    let skip = 0, pages = 3
    while (pages > 0 && needed.size > lastSoldMap.size) {
      const r = await fetch(
        `${sapBase}/b1s/v2/Invoices?$select=DocDate,DocumentLines&$orderby=DocDate desc&$top=20&$skip=${skip}`,
        { headers, credentials: 'include' }
      )
      if (!r.ok || r.status === 401) break
      const invs = (await r.json()).value ?? []
      if (!invs.length) break
      for (const inv of invs) for (const line of inv.DocumentLines ?? []) {
        if (needed.has(line.ItemCode) && !lastSoldMap.has(line.ItemCode)) {
          lastSoldMap.set(line.ItemCode, { price: line.Price ?? 0, currency: normCurrency(line.Currency), discount: line.DiscountPercent ?? null })
        }
      }
      if (invs.length < 20) break
      skip += 20; pages--
    }
  } catch {}

  return Promise.all(sapItems.map(async item => {
    const prices = item.ItemPrices ?? []
    const primary = prices.find(p => p.PriceList === 1 && p.Price > 0) ?? prices.find(p => p.Price > 0) ?? prices[0] ?? null
    const sold = lastSoldMap.get(item.ItemCode) ?? null
    return {
      itemCode: item.ItemCode, itemName: item.ItemName,
      price: primary?.Price ?? 0, lastSoldPrice: sold?.price ?? null, discount: sold?.discount ?? null,
      priceListName: await getPL(primary?.PriceList ?? 1), currency: normCurrency(primary?.Currency),
    }
  }))
}

async function searchViaSupabase(query, session) {
  const res = await fetch(
    `${supabaseUrl}/functions/v1/get-item-price?search=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${supabaseAnonKey}`, 'x-sap-session': session.sapSession.sessionToken, 'x-sap-company': session.sapSession.companyDB } }
  )
  if (res.status === 401) throw new Error('session_expired')
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error ${res.status}`) }
  const data = await res.json()
  if (data?.error === 'offline') throw new Error('You are offline — showing cached data')
  return Array.isArray(data) ? data : data ? [data] : []
}

// ── Supabase info (for display only) ──────────────────────────────────────
export const SUPABASE_INFO = {
  projectRef: 'stketabfgrcblcrcjauc',
  url: supabaseUrl,
  schema: 'public',
  tables: ['price_cache'],
}
