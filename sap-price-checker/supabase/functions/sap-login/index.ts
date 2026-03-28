/**
 * Supabase Edge Function: sap-login
 *
 * Accepts POST { username, password, companyDB }, forwards the credentials
 * to SAP Service Layer POST /b1s/v1/Login, and returns the session token.
 *
 * Environment variable required (set via `supabase secrets set`):
 *   SAP_SERVICE_LAYER_URL  e.g. https://your-sap-server:50000
 *
 * The raw password is only ever held in the running function's memory for the
 * duration of this request. It is never logged or persisted.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', message: 'Only POST is accepted' }, 405)
  }

  // ── Parse request body ──────────────────────────────────────────────────────
  let username: string
  let password: string
  let companyDB: string

  try {
    const body = await req.json()
    username = body?.username
    password = body?.password
    companyDB = body?.companyDB
  } catch {
    return json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400)
  }

  if (!username || !password || !companyDB) {
    return json(
      {
        error: 'missing_fields',
        message: 'username, password, and companyDB are all required',
      },
      400
    )
  }

  // ── Validate SAP_SERVICE_LAYER_URL ──────────────────────────────────────────
  const sapBaseUrl = Deno.env.get('SAP_SERVICE_LAYER_URL')
  if (!sapBaseUrl) {
    console.error('sap-login: SAP_SERVICE_LAYER_URL secret is not set')
    return json(
      { error: 'config_error', message: 'Server configuration error. Contact your administrator.' },
      500
    )
  }

  // ── Call SAP Service Layer Login ────────────────────────────────────────────
  let sapRes: Response
  try {
    sapRes = await fetch(`${sapBaseUrl}/b1s/v2/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: username,
        Password: password,
        CompanyDB: companyDB,
      }),
    })
  } catch (networkErr) {
    console.error('sap-login: network error reaching SAP Service Layer:', networkErr)
    return json(
      {
        error: 'sap_unreachable',
        message: 'Cannot reach SAP Service Layer. Check your network or SAP server status.',
      },
      502
    )
  }

  // ── Handle SAP response ─────────────────────────────────────────────────────
  if (sapRes.status === 401 || sapRes.status === 400) {
    // SAP returns 401 for wrong password, 400 for wrong company DB
    return json(
      { error: 'invalid_credentials', message: 'Invalid SAP credentials' },
      401
    )
  }

  if (!sapRes.ok) {
    let sapBody = ''
    try {
      sapBody = await sapRes.text()
    } catch {
      // ignore
    }
    console.error(`sap-login: SAP returned ${sapRes.status}:`, sapBody)
    return json(
      {
        error: 'sap_error',
        message: `SAP Service Layer returned an unexpected error (HTTP ${sapRes.status})`,
      },
      502
    )
  }

  let loginData: Record<string, unknown>
  try {
    loginData = await sapRes.json()
  } catch {
    return json(
      { error: 'sap_parse_error', message: 'Could not parse SAP login response' },
      502
    )
  }

  const sessionToken = loginData.SessionId as string | undefined
  if (!sessionToken) {
    console.error('sap-login: SAP login succeeded but SessionId is missing', loginData)
    return json(
      { error: 'no_session_token', message: 'SAP did not return a session token' },
      502
    )
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  return json({ sessionToken, companyDB })
})
