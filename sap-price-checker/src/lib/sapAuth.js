/**
 * SAP + Supabase Dual Session Manager
 *
 * Manages two sessions simultaneously:
 *   1. SAP B1 Session — from WebClient SSO context or manual login via Edge Function
 *   2. Supabase Session — for database queries, price cache, schema access
 *
 * Both sessions live in React state only — never in localStorage/sessionStorage.
 */

import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'

// ── SAP WebClient SSO Detection ──────────────────────────────────────────
const SAP_CONTEXT_GETTERS = [
  () => window?.sap?.b1?.context,
  () => window?.parent?.sap?.b1?.context,
]

export function detectSAPWebclientSession() {
  for (const getCtx of SAP_CONTEXT_GETTERS) {
    try {
      const ctx = getCtx()
      if (ctx && ctx.sessionToken && ctx.companyDB) {
        return {
          sessionToken: ctx.sessionToken,
          companyDB: ctx.companyDB,
          username: ctx.username ?? ctx.userName ?? '',
        }
      }
    } catch { /* cross-origin frame may throw */ }
  }
  return null
}

/**
 * On mount: try to detect SSO session from SAP WebClient.
 * Returns { sapSession, mode } or null.
 */
export async function getOrCreateSession() {
  const sso = detectSAPWebclientSession()
  if (sso) {
    return {
      mode: 'sso',
      sapSession: {
        sessionToken: sso.sessionToken,
        companyDB: sso.companyDB,
      },
      username: sso.username,
    }
  }
  return null // App will show login form
}

/**
 * Mode B login — calls Supabase Edge Function to authenticate against SAP.
 * Returns both the SAP session token AND initializes a Supabase connection.
 */
export async function loginWithCredentials(credentials) {
  const { username, password, companyDB } = credentials

  // Step 1: Get SAP session via Edge Function
  const { data, error } = await supabase.functions.invoke('sap-login', {
    body: { username, password, companyDB },
  })

  if (error) {
    const status = error?.context?.status ?? error?.status ?? 0
    if (status === 401) throw new Error('invalid_credentials')
    throw new Error(error.message ?? 'Login failed.')
  }

  if (!data?.sessionToken) {
    throw new Error('SAP did not return a session token.')
  }

  return {
    mode: 'standalone',
    sapSession: {
      sessionToken: data.sessionToken,
      companyDB: data.companyDB ?? companyDB,
    },
    username,
  }
}

/**
 * Fetch Supabase database schema info — tables, row counts
 */
export async function fetchSupabaseSchema() {
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/get-schema-info`,
      {
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
      }
    )
    if (res.ok) {
      return await res.json()
    }
  } catch { /* non-critical */ }

  // Fallback: return known tables
  return {
    tables: [
      { name: 'price_cache', description: 'Cached SAP item prices' },
    ],
  }
}

/**
 * Build headers for Edge Function calls — includes both SAP and Supabase auth
 */
export function buildSAPHeaders(session) {
  return {
    'x-sap-session': session.sapSession.sessionToken,
    'x-sap-company': session.sapSession.companyDB,
  }
}
