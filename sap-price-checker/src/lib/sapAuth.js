/**
 * Dual-Mode Authentication & API Layer
 *
 * Inside SAP Web Client:
 *   → The user is ALREADY logged in — no login screen needed
 *   → Reuse the existing SAP session via cookies (credentials: 'include')
 *   → Try SSO context first, then cookie-based session, then direct login
 *
 * Standalone (Netlify / localhost):
 *   → Show login form, call Supabase Edge Functions
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'

// ── Environment detection ─────────────────────────────────────────────────
export function isInsideSAPWebClient() {
  try {
    const url = window.location.href
    if (url.includes('/extn/') || url.includes('/webclient/') || url.includes('/ui-static/')) return true
    if (window?.sap?.b1?.context) return true
    if (window?.parent?.sap?.b1?.context) return true
  } catch {}
  return false
}

// ── Currency normalizer ───────────────────────────────────────────────────
const CURRENCY_MAP = { '$':'USD','€':'EUR','£':'GBP','¥':'JPY','₹':'INR' }
function normCurrency(raw) {
  if (!raw) return 'USD'
  if (CURRENCY_MAP[raw]) return CURRENCY_MAP[raw]
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD'
}

// ── Try to get company DB from SAP context or URL ─────────────────────────
function detectCompanyDB() {
  // From SSO context
  try { if (window?.sap?.b1?.context?.companyDB) return window.sap.b1.context.companyDB } catch {}
  try { if (window?.parent?.sap?.b1?.context?.companyDB) return window.parent.sap.b1.context.companyDB } catch {}

  // From URL params (SAP sometimes passes it)
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('CompanyDB')) return params.get('CompanyDB')
    if (params.get('companydb')) return params.get('companydb')
  } catch {}

  // From parent URL
  try {
    const parentParams = new URLSearchParams(window.parent.location.search)
    if (parentParams.get('CompanyDB')) return parentParams.get('CompanyDB')
  } catch {}

  return null
}

// ── Try to get username from SAP context ──────────────────────────────────
function detectUsername() {
  try { return window?.sap?.b1?.context?.username ?? window?.sap?.b1?.context?.userName } catch {}
  try { return window?.parent?.sap?.b1?.context?.username ?? window?.parent?.sap?.b1?.context?.userName } catch {}
  return null
}

// ── Test if SAP Service Layer is accessible with existing cookies ──────────
async function probeExistingSession() {
  const sapBase = window.location.origin
  try {
    // Call a lightweight endpoint to check if we have a valid session via cookies
    const res = await fetch(`${sapBase}/b1s/v2/CompanyService_GetCompanyInfo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',  // sends existing B1SESSION cookie
      signal: AbortSignal.timeout(5000),
    })

    if (res.ok) {
      const info = await res.json()
      return {
        companyDB: info.CompanyDB ?? info.CompanyName ?? detectCompanyDB() ?? 'Unknown',
        sessionToken: 'cookie-session', // session is managed via cookies
        valid: true,
      }
    }

    // Try a simpler endpoint
    const res2 = await fetch(`${sapBase}/b1s/v2/Items?$top=1&$select=ItemCode`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    })
    if (res2.ok) {
      return {
        companyDB: detectCompanyDB() ?? 'Unknown',
        sessionToken: 'cookie-session',
        valid: true,
      }
    }
  } catch {}
  return { valid: false }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SESSION INIT (called on app mount)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function getOrCreateSession() {
  const insideWebClient = isInsideSAPWebClient()

  if (!insideWebClient) return null // Standalone → show login form

  // ── Strategy 1: SSO context object ──────────────────────────────────────
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
    } catch {}
  }

  // ── Strategy 2: Reuse existing cookies (user is already logged in) ──────
  // The Web Client has a valid B1SESSION cookie — our fetch with
  // credentials:'include' will piggyback on it automatically
  const probe = await probeExistingSession()
  if (probe.valid) {
    return {
      mode: 'webclient',
      sapSession: {
        sessionToken: probe.sessionToken,
        companyDB: probe.companyDB,
      },
      username: detectUsername() ?? 'Web Client User',
      useDirectAPI: true,
    }
  }

  // ── Strategy 3: If nothing works, still try direct API without login ────
  // Return a session that uses cookies only (no explicit token)
  const companyDB = detectCompanyDB()
  if (companyDB) {
    return {
      mode: 'webclient',
      sapSession: { sessionToken: 'cookie-session', companyDB },
      username: detectUsername() ?? 'Web Client User',
      useDirectAPI: true,
    }
  }

  // ── Last resort: return a webclient session anyway ──────────────────────
  // The user IS inside Web Client — we should never show a login form
  return {
    mode: 'webclient',
    sapSession: { sessionToken: 'cookie-session', companyDB: 'Auto-detected' },
    username: detectUsername() ?? 'Web Client User',
    useDirectAPI: true,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LOGIN (standalone mode only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function loginDirect(username, password, companyDB) {
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
  if (session.useDirectAPI) return searchDirect(query, session)
  return searchViaSupabase(query, session)
}

async function searchDirect(query, session) {
  const sapBase = window.location.origin
  const safe = query.replace(/'/g, "''")
  const filter = `startswith(ItemCode,'${safe}') or contains(ItemName,'${safe}')`

  // Use credentials:'include' to send the existing B1SESSION cookie
  // No need to manually set Cookie header — the browser handles it
  const headers = { 'Content-Type': 'application/json' }
  const fetchOpts = { headers, credentials: 'include' }

  // If we have an explicit session token (from SSO), also set the cookie header
  if (session.sapSession.sessionToken && session.sapSession.sessionToken !== 'cookie-session') {
    headers.Cookie = `B1SESSION=${session.sapSession.sessionToken}; CompanyDB=${encodeURIComponent(session.sapSession.companyDB)}`
  }

  // Fetch items
  const itemsRes = await fetch(
    `${sapBase}/b1s/v2/Items?$filter=${encodeURIComponent(filter)}&$select=ItemCode,ItemName,ItemPrices&$top=10`,
    fetchOpts
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
      const r = await fetch(`${sapBase}/b1s/v2/PriceLists(${num})?$select=PriceListNo,PriceListName`, fetchOpts)
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
        fetchOpts
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
