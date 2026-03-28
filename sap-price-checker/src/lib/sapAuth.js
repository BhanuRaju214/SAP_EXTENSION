/**
 * SAP Authentication Helper
 *
 * Mode A — SSO (inside SAP Webclient):
 *   Reads the active session silently from window.sap.b1.context or
 *   window.parent.sap.b1.context. No login screen is shown.
 *
 * Mode B — Standalone:
 *   User provides SAP B1 credentials via LoginForm. This module calls the
 *   Supabase Edge Function `sap-login`, which proxies the authentication
 *   to SAP Service Layer. The session token is returned to React state only —
 *   it is never written to localStorage, sessionStorage, or any cookie.
 */

/** Candidate getters for the SAP Webclient context object. */
const SAP_CONTEXT_GETTERS = [
  () => window?.sap?.b1?.context,
  () => window?.parent?.sap?.b1?.context,
]

/**
 * Attempts to read an active SAP B1 session injected by the host Webclient
 * frame. Returns a session object for Mode A, or null if no context is found.
 *
 * @returns {{ mode: 'sso', sessionToken: string, companyDB: string, username: string } | null}
 */
export function detectSAPWebclientSession() {
  for (const getCtx of SAP_CONTEXT_GETTERS) {
    try {
      const ctx = getCtx()
      if (ctx && ctx.sessionToken && ctx.companyDB) {
        return {
          mode: 'sso',
          sessionToken: ctx.sessionToken,
          companyDB: ctx.companyDB,
          username: ctx.username ?? ctx.userName ?? '',
        }
      }
    } catch {
      // Cross-origin frame access may throw a SecurityError — suppress it and
      // try the next getter.
    }
  }
  return null
}

/**
 * Called once on app mount. Returns an SSO session if the app is running
 * inside SAP Webclient, otherwise returns null (which causes App.jsx to
 * render LoginForm for Mode B).
 *
 * @returns {Promise<{ mode: 'sso', sessionToken: string, companyDB: string, username: string } | null>}
 */
export async function getOrCreateSession() {
  return detectSAPWebclientSession()
}

/**
 * Mode B login flow. Calls the Supabase Edge Function `sap-login`, which in
 * turn POSTs to SAP Service Layer /b1s/v1/Login. Returns a session object on
 * success. The raw password is never stored anywhere after this call returns.
 *
 * @param {{ username: string, password: string, companyDB: string }} credentials
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {Promise<{ mode: 'standalone', sessionToken: string, companyDB: string }>}
 * @throws {Error} 'invalid_credentials' on 401 — caller should show the
 *   "Invalid SAP credentials" message. Any other error message is surfaced as-is.
 */
export async function loginWithCredentials(credentials, supabaseClient) {
  const { username, password, companyDB } = credentials

  const { data, error } = await supabaseClient.functions.invoke('sap-login', {
    body: { username, password, companyDB },
  })

  if (error) {
    // FunctionsHttpError wraps the underlying HTTP response in error.context
    const status = error?.context?.status ?? error?.status ?? 0
    if (status === 401) {
      throw new Error('invalid_credentials')
    }
    throw new Error(error.message ?? 'Login failed. Please try again.')
  }

  if (!data?.sessionToken) {
    throw new Error('Login failed: SAP did not return a session token.')
  }

  return {
    mode: 'standalone',
    sessionToken: data.sessionToken,
    companyDB: data.companyDB ?? companyDB,
  }
}

/**
 * Builds the custom SAP headers that must accompany every Edge Function call.
 * The session token travels in a request header only — never in the URL or body.
 *
 * @param {{ sessionToken: string, companyDB: string }} session
 * @returns {Record<string, string>}
 */
export function buildSAPHeaders(session) {
  return {
    'x-sap-session': session.sessionToken,
    'x-sap-company': session.companyDB,
  }
}
