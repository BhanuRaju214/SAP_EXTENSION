import { useState, useEffect, useCallback } from 'react'
import {
  getOrCreateSession, loginDirect, loginViaSupabase,
  searchItems, isInsideSAPWebClient, SUPABASE_INFO
} from './lib/sapAuth'
import LoginForm from './components/LoginForm'
import SearchBar from './components/SearchBar'
import PriceCard from './components/PriceCard'

const EXPIRED_MSG = 'Your session expired. Please log in again.'

export default function App() {
  const [session,        setSession]        = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [loginLoading,   setLoginLoading]   = useState(false)
  const [loginError,     setLoginError]     = useState(null)
  const [searchResults,  setSearchResults]  = useState([])
  const [selectedItem,   setSelectedItem]   = useState(null)
  const [searchLoading,  setSearchLoading]  = useState(false)
  const [searchError,    setSearchError]    = useState(null)
  const [isOffline,      setIsOffline]      = useState(!navigator.onLine)

  const inWebClient = isInsideSAPWebClient()

  useEffect(() => {
    const on = () => setIsOffline(false), off = () => setIsOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // SSO detection
  useEffect(() => {
    getOrCreateSession()
      .then(s => { if (s?.sapSession) setSession(s) }) // only set if we got a real session
      .catch(console.error)
      .finally(() => setSessionLoading(false))
  }, [])

  const expire = useCallback(() => {
    setSession(null); setSearchResults([]); setSelectedItem(null)
    setSearchError(null); setLoginError(EXPIRED_MSG)
  }, [])

  // Login — try Supabase first (works if CSP meta tag is in place),
  // fall back to direct SAP API if CSP blocks Supabase
  async function handleLogin(creds) {
    setLoginLoading(true); setLoginError(null)
    try {
      let result
      try {
        // Try Supabase Edge Function first (works everywhere if CSP allows it)
        result = await loginViaSupabase(creds.username, creds.password, creds.companyDB)
      } catch (supaErr) {
        if (supaErr.message === 'invalid_credentials') throw supaErr
        if (inWebClient) {
          // Supabase blocked by CSP → fall back to direct SAP API
          console.warn('Supabase unreachable, falling back to direct SAP API:', supaErr.message)
          result = await loginDirect(creds.username, creds.password, creds.companyDB)
        } else {
          throw supaErr
        }
      }
      setSession(result)
    } catch (e) {
      setLoginError(e.message === 'invalid_credentials'
        ? 'Invalid SAP credentials. Please try again.'
        : e.message || 'Login failed.')
    } finally { setLoginLoading(false) }
  }

  // Search — auto-routes to direct or Supabase based on session.useDirectAPI
  const handleSearch = useCallback(async (query) => {
    if (!query) { setSearchResults([]); setSearchError(null); return }
    if (!session) return
    setSearchLoading(true); setSearchError(null)
    try {
      setSearchResults(await searchItems(query, session))
    } catch (e) {
      if (e.message === 'session_expired') { expire(); return }
      setSearchError(navigator.onLine ? (e.message || 'Search failed.') : 'You are offline.')
    } finally { setSearchLoading(false) }
  }, [session, expire])

  // ── Loading ────────────────────────────────────────────────────────────
  if (sessionLoading) return (
    <div className="min-h-screen bg-sap-bg flex items-center justify-center">
      <div className="text-center">
        <svg className="animate-spin w-10 h-10 text-sap-blue mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-sap-text-2 text-sm">Connecting…</p>
      </div>
    </div>
  )

  // ── Login form ─────────────────────────────────────────────────────────
  if (!session) return (
    <LoginForm
      onLogin={handleLogin}
      isLoading={loginLoading}
      error={loginError}
      apiMode={inWebClient ? 'Direct SAP (same-origin)' : 'Supabase Edge Functions'}
      supabaseInfo={SUPABASE_INFO}
    />
  )

  // ── Main app ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-sap-bg flex flex-col font-sans">

      {/* Shell bar */}
      <header className="bg-sap-shell flex-shrink-0 z-20 shadow-sap-md">
        <div className="h-12 px-4 flex items-center gap-3">
          <svg viewBox="0 0 40 18" className="h-5 flex-shrink-0">
            <rect width="40" height="18" rx="2" fill="#fff"/>
            <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
              fill="#0070F2" fontSize="9" fontWeight="700" fontFamily="Arial,sans-serif" letterSpacing="0.5">SAP</text>
          </svg>
          <div className="w-px h-5 bg-blue-400 opacity-40"/>
          <span className="text-white font-semibold text-sm flex-1 truncate">Price Checker</span>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isOffline && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-200">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400"/> Offline
              </span>
            )}
            {/* API Mode badge */}
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold
              ${session.useDirectAPI ? 'bg-green-800 text-green-100' : 'bg-purple-800 text-purple-100'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${session.useDirectAPI ? 'bg-green-400' : 'bg-purple-400'}`}/>
              {session.useDirectAPI ? 'Direct SAP API' : 'via Supabase'}
            </span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold
              ${session.mode === 'webclient' ? 'bg-blue-700 text-blue-100' : 'bg-blue-800 text-blue-200'}`}>
              {session.mode === 'webclient' ? 'Web Client' : 'Standalone'}
            </span>
            <button onClick={expire} type="button" title="Sign out"
              className="p-1.5 rounded text-blue-200 hover:text-white hover:bg-blue-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Session info bar */}
        <div className="px-4 py-2 bg-white border-b border-sap-border flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* SAP Session */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500"/>
            <span className="text-xs text-sap-text-2">SAP:</span>
            <span className="text-xs font-mono font-semibold text-sap-text-1">{session.sapSession.companyDB}</span>
            <span className="text-xs text-sap-text-2 hidden sm:inline">
              ({session.sapSession.sessionToken.substring(0, 8)}…)
            </span>
          </div>
          <span className="text-sap-border">|</span>
          {/* Supabase info */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"/>
            <span className="text-xs text-sap-text-2">Supabase:</span>
            <span className="text-xs font-mono font-semibold text-sap-text-1">{SUPABASE_INFO.projectRef}</span>
            <span className="text-xs text-sap-text-2">/ {SUPABASE_INFO.schema}</span>
          </div>
          <span className="text-sap-border">|</span>
          {/* User */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-sap-text-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
            <span className="text-xs font-medium text-sap-text-1">{session.username || 'SSO'}</span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-5 space-y-4">

        {isOffline && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            You are offline — showing cached data
          </div>
        )}

        {/* Connection Info Panel */}
        <div className="bg-white rounded-lg border border-sap-border shadow-sap-sm">
          <div className="px-4 py-2 bg-sap-bg border-b border-sap-border rounded-t-lg">
            <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide">
              Connection Details
            </span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* SAP Connection */}
            <div className="bg-sap-blue-lt rounded-lg p-3 border border-blue-100">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>
                <span className="text-xs font-semibold text-sap-blue uppercase">SAP B1 Service Layer</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">Company DB</span>
                  <span className="text-xs font-mono font-bold text-sap-text-1">{session.sapSession.companyDB}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">API Version</span>
                  <span className="text-xs font-mono text-sap-text-1">v2</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">Connection</span>
                  <span className="text-xs font-semibold text-green-700">
                    {session.useDirectAPI ? 'Direct (same-origin)' : 'Via Supabase proxy'}
                  </span>
                </div>
              </div>
            </div>

            {/* Supabase Connection */}
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"/>
                <span className="text-xs font-semibold text-emerald-700 uppercase">Supabase Database</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">Project</span>
                  <span className="text-xs font-mono font-bold text-sap-text-1">{SUPABASE_INFO.projectRef}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">Schema</span>
                  <span className="text-xs font-mono text-sap-text-1">{SUPABASE_INFO.schema}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-sap-text-2">Cache Table</span>
                  <span className="text-xs font-mono text-sap-text-1">price_cache</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg border border-sap-border shadow-sap-sm p-4">
          <label className="block text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-2">
            Search Items
          </label>
          <SearchBar
            onSearch={handleSearch}
            onSelect={setSelectedItem}
            results={searchResults}
            isSearching={searchLoading}
          />
          {searchError && (
            <p className="mt-2 text-xs text-sap-error flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              {searchError}
            </p>
          )}
        </div>

        {/* Price card */}
        {selectedItem ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide">Item Details</span>
              <button onClick={() => setSelectedItem(null)} type="button"
                className="text-xs text-sap-blue hover:underline font-medium">← Back</button>
            </div>
            <PriceCard item={selectedItem}/>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-dashed border-sap-border shadow-sap-sm py-14 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-sap-bg flex items-center justify-center">
              <svg className="w-7 h-7 text-sap-border" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-sap-text-2">No item selected</p>
            <p className="text-xs text-sap-text-2 mt-1">Type a code like <span className="font-mono text-sap-blue">A00001</span> or item name above</p>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-sap-border py-2 px-4 text-center flex-shrink-0">
        <p className="text-xs text-sap-text-2">
          SAP <span className="font-mono">{session.sapSession.companyDB}</span>
          {' · Supabase '}
          <span className="font-mono">{SUPABASE_INFO.projectRef}</span>
          {' · '}
          {session.useDirectAPI ? 'Direct API' : 'Edge Functions'}
        </p>
      </footer>
    </div>
  )
}
