import { useState } from 'react'

export default function LoginForm({ onLogin, isLoading, error, apiMode, supabaseInfo }) {
  const [username,  setUsername]  = useState('')
  const [password,  setPassword]  = useState('')
  const [companyDB, setCompanyDB] = useState('')
  const [showPwd,   setShowPwd]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const creds = { username, password, companyDB }
    setPassword('')
    await onLogin(creds)
  }

  const canSubmit = username.trim() && password && companyDB.trim() && !isLoading

  return (
    <div className="min-h-screen bg-sap-bg flex flex-col">
      {/* Shell bar */}
      <div className="h-12 bg-sap-shell flex items-center px-6 shadow-sap-md">
        <svg viewBox="0 0 40 18" className="h-5">
          <rect width="40" height="18" rx="2" fill="#fff"/>
          <text x="50%" y="55%" dominantBaseline="middle" textAnchor="middle"
            fill="#0070F2" fontSize="9" fontWeight="700" fontFamily="Arial,sans-serif" letterSpacing="0.5">SAP</text>
        </svg>
        <div className="w-px h-5 bg-blue-400 opacity-40 mx-3"/>
        <span className="text-white text-sm font-semibold">Price Checker</span>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">

          {/* Login card */}
          <div className="bg-white rounded-lg border border-sap-border shadow-sap-md overflow-hidden">

            {/* Header */}
            <div className="bg-sap-shell px-6 py-5 text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/10 flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                </svg>
              </div>
              <h1 className="text-white font-semibold text-base">Sign In</h1>
              <p className="text-blue-200 text-xs mt-0.5">SAP Business One credentials</p>
            </div>

            <div className="px-6 py-6 space-y-4">
              {error && (
                <div className="flex items-start gap-2 p-3 bg-sap-error-bg border border-red-200 rounded text-sm text-sap-error">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="u" className="block text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-1.5">
                    User Name <span className="text-sap-error">*</span>
                  </label>
                  <input id="u" type="text" value={username} onChange={e => setUsername(e.target.value)}
                    required autoComplete="username" placeholder="e.g. manager" disabled={isLoading}
                    className="w-full px-3 py-2.5 text-sm border-2 border-sap-border rounded focus:border-sap-blue focus:outline-none text-sap-text-1 placeholder-gray-400 disabled:bg-sap-bg transition-colors"/>
                </div>

                <div>
                  <label htmlFor="p" className="block text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-1.5">
                    Password <span className="text-sap-error">*</span>
                  </label>
                  <div className="relative">
                    <input id="p" type={showPwd ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)} required autoComplete="current-password"
                      placeholder="••••••••" disabled={isLoading}
                      className="w-full px-3 py-2.5 pr-10 text-sm border-2 border-sap-border rounded focus:border-sap-blue focus:outline-none text-sap-text-1 placeholder-gray-400 disabled:bg-sap-bg transition-colors"/>
                    <button type="button" tabIndex={-1} onClick={() => setShowPwd(v => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-sap-text-2 hover:text-sap-text-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {showPwd
                          ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18"/>
                          : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></>
                        }
                      </svg>
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="c" className="block text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-1.5">
                    Company DB <span className="text-sap-error">*</span>
                  </label>
                  <input id="c" type="text" value={companyDB} onChange={e => setCompanyDB(e.target.value)}
                    required autoComplete="off" placeholder="e.g. SBODEMOUS" disabled={isLoading}
                    className="w-full px-3 py-2.5 text-sm border-2 border-sap-border rounded focus:border-sap-blue focus:outline-none text-sap-text-1 placeholder-gray-400 font-mono disabled:bg-sap-bg transition-colors"/>
                </div>

                <button type="submit" disabled={!canSubmit}
                  className="w-full py-3 px-4 rounded text-sm font-semibold transition-all bg-sap-blue hover:bg-sap-blue-dk disabled:bg-sap-border disabled:text-gray-400 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-sap-blue focus:ring-offset-2">
                  {isLoading ? (
                    <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>Signing in…</>
                  ) : 'Sign In'}
                </button>
              </form>
            </div>
          </div>

          {/* Supabase & API info card */}
          <div className="bg-white rounded-lg border border-sap-border shadow-sap-sm overflow-hidden">
            <div className="px-4 py-2 bg-sap-bg border-b border-sap-border">
              <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide">
                Connection Details
              </span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">

              {/* API Mode */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-sap-text-2 uppercase">API Mode</span>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold
                  ${apiMode?.includes('Direct') ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full
                    ${apiMode?.includes('Direct') ? 'bg-green-500 animate-pulse' : 'bg-purple-500 animate-pulse'}`}/>
                  {apiMode || 'Detecting…'}
                </div>
                <p className="text-xs text-sap-text-2">
                  {apiMode?.includes('Direct')
                    ? 'Calling SAP directly — no CSP issues'
                    : 'Routing through Supabase Edge Functions'}
                </p>
              </div>

              {/* Supabase */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-sap-text-2 uppercase">Supabase DB</span>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                    <span className="text-xs font-mono font-bold text-sap-text-1">
                      {supabaseInfo?.projectRef ?? 'stketabfgrcblcrcjauc'}
                    </span>
                  </div>
                  <p className="text-xs text-sap-text-2">
                    Schema: <span className="font-mono">{supabaseInfo?.schema ?? 'public'}</span>
                  </p>
                  <p className="text-xs text-sap-text-2">
                    Tables: <span className="font-mono">{supabaseInfo?.tables?.join(', ') ?? 'price_cache'}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-sap-text-2">
            Use your existing SAP B1 account — no separate registration
          </p>
        </div>
      </div>
    </div>
  )
}
