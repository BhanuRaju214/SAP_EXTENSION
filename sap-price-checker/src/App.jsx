import { useState, useEffect, useCallback } from 'react'
import { supabase, supabaseUrl, supabaseAnonKey } from './lib/supabase'
import { getOrCreateSession, loginWithCredentials, buildSAPHeaders } from './lib/sapAuth'
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

  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const on  = () => setIsOffline(false)
    const off = () => setIsOffline(true)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // SSO detection
  useEffect(() => {
    getOrCreateSession()
      .then(sso => { if (sso) setSession(sso) })
      .catch(console.error)
      .finally(() => setSessionLoading(false))
  }, [])

  const expire = useCallback(() => {
    setSession(null); setSearchResults([]); setSelectedItem(null)
    setSearchError(null); setLoginError(EXPIRED_MSG)
  }, [])

  async function handleLogin(creds) {
    setLoginLoading(true); setLoginError(null)
    try { setSession(await loginWithCredentials(creds, supabase)) }
    catch (e) {
      setLoginError(e.message === 'invalid_credentials'
        ? 'Invalid SAP credentials. Please try again.'
        : e.message || 'Login failed.')
    } finally { setLoginLoading(false) }
  }

  const handleSearch = useCallback(async (query) => {
    if (!query) { setSearchResults([]); setSearchError(null); return }
    if (!session) return
    setSearchLoading(true); setSearchError(null)
    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/get-item-price?search=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${supabaseAnonKey}`, ...buildSAPHeaders(session) } }
      )
      if (res.status === 401) { expire(); return }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.message || `Error ${res.status}`)
      }
      const data = await res.json()
      if (data?.error === 'offline') { setSearchError('You are offline — showing cached data'); return }
      const items = Array.isArray(data) ? data : data ? [data] : []
      setSearchResults(items)
    } catch (e) {
      setSearchError(navigator.onLine ? (e.message || 'Search failed.') : 'You are offline.')
    } finally { setSearchLoading(false) }
  }, [session, expire])

  // When user picks an item from dropdown
  function handleSelect(item) {
    setSelectedItem(item)   // null clears the card
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (sessionLoading) return (
    <div className="min-h-screen bg-sap-bg flex items-center justify-center">
      <div className="text-center">
        <svg className="animate-spin w-10 h-10 text-sap-blue mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <p className="text-sap-text-2 text-sm">Initialising…</p>
      </div>
    </div>
  )

  // ── Login ──────────────────────────────────────────────────────────────────
  if (!session) return <LoginForm onLogin={handleLogin} isLoading={loginLoading} error={loginError}/>

  // ── Main ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-sap-bg flex flex-col font-sans">

      {/* SAP Shell Bar */}
      <header className="bg-sap-shell flex-shrink-0 z-20 shadow-sap-md">
        <div className="h-12 px-4 flex items-center gap-3">
          {/* Logo */}
          <svg viewBox="0 0 40 18" className="h-5 flex-shrink-0" aria-label="SAP">
            <rect width="40" height="18" rx="2" fill="#fff"/>
            <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
              fill="#0070F2" fontSize="9" fontWeight="700" fontFamily="Arial,sans-serif" letterSpacing="0.5">
              SAP
            </text>
          </svg>
          <div className="w-px h-5 bg-blue-400 opacity-40"/>
          <span className="text-white font-semibold text-sm tracking-wide flex-1 truncate">
            Price Checker
          </span>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isOffline && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-200">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"/> Offline
              </span>
            )}
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold
              ${session.mode==='sso' ? 'bg-blue-700 text-blue-100' : 'bg-blue-800 text-blue-200'}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block
                ${session.mode==='sso' ? 'bg-green-400' : 'bg-blue-300'}`}/>
              {session.mode==='sso' ? 'SAP Webclient' : 'Standalone'}
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

        {/* Sub-header */}
        <div className="h-9 px-4 bg-white border-b border-sap-border flex items-center gap-2">
          <svg className="w-4 h-4 text-sap-blue flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z"/>
          </svg>
          <span className="text-sm font-semibold text-sap-text-1">Quick Price Lookup</span>
          <span className="text-sap-border mx-1">|</span>
          <span className="text-xs text-sap-text-2">
            Company: <span className="font-medium text-sap-text-1">{session.companyDB}</span>
          </span>
        </div>
      </header>

      {/* Page */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-5 space-y-4">

        {/* Offline banner */}
        {isOffline && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            You are offline — showing cached data
          </div>
        )}

        {/* Search panel */}
        <div className="bg-white rounded-lg border border-sap-border shadow-sap-sm p-4">
          <label className="block text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-2">
            Search Items
          </label>
          <SearchBar
            onSearch={handleSearch}
            onSelect={handleSelect}
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
              <button onClick={() => { setSelectedItem(null) }} type="button"
                className="text-xs text-sap-blue hover:underline font-medium">
                ← Back to search
              </button>
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
            <p className="text-xs text-sap-text-2 mt-1 max-w-xs mx-auto">
              Type a code like <span className="font-mono text-sap-blue">A00001</span> or part of an item name above,
              then click a result to see its price
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-sap-border py-2 px-4 text-center flex-shrink-0">
        <p className="text-xs text-sap-text-2">
          SAP Business One · Price Checker · <span className="font-mono">{session.companyDB}</span>
        </p>
      </footer>
    </div>
  )
}
