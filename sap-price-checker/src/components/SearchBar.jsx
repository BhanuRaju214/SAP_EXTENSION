import { useState, useEffect, useRef, useCallback } from 'react'

const CURRENCY_MAP = { '$':'USD','€':'EUR','£':'GBP','¥':'JPY','₹':'INR' }

function fmt(val, raw) {
  if (val == null) return '—'
  const code = CURRENCY_MAP[raw] || (/^[A-Z]{3}$/.test(raw) ? raw : 'USD')
  try {
    return new Intl.NumberFormat(undefined, {
      style:'currency', currency:code, minimumFractionDigits:2, maximumFractionDigits:2
    }).format(val)
  } catch { return `${raw||'$'}${Number(val).toFixed(2)}` }
}

export default function SearchBar({ onSearch, onSelect, results, isSearching }) {
  const items = Array.isArray(results) ? results : []
  const [value,     setValue]     = useState('')
  const [open,      setOpen]      = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const debounceRef  = useRef(null)
  const containerRef = useRef(null)
  const inputRef     = useRef(null)

  // ── Debounce ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) { onSearch(null); setOpen(false); return }
    debounceRef.current = setTimeout(() => onSearch(value.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value]) // eslint-disable-line

  // ── Open dropdown when results arrive ─────────────────────────────────────
  useEffect(() => {
    if (items.length > 0) { setOpen(true); setActiveIdx(-1) }
  }, [results]) // eslint-disable-line

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(item) {
    setValue(item.itemCode)
    setOpen(false)
    setActiveIdx(-1)
    onSelect(item)
  }

  function clear() {
    setValue(''); setOpen(false); setActiveIdx(-1)
    onSearch(null); onSelect(null)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (!open || !items.length) return
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActiveIdx(i => Math.min(i+1, items.length-1)) }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); setActiveIdx(i => Math.max(i-1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); select(items[activeIdx]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showDrop = open && value.trim().length > 0

  return (
    <div ref={containerRef} className="relative w-full">

      {/* ── Input row ── */}
      <div className={`flex items-center bg-white border-2 transition-colors
        ${showDrop ? 'border-sap-blue rounded-t-lg rounded-b-none'
                   : 'border-sap-border rounded-lg hover:border-sap-blue focus-within:border-sap-blue'}`}>
        <div className="pl-3 flex-shrink-0 text-sap-text-2">
          {isSearching
            ? <svg className="animate-spin w-5 h-5 text-sap-blue" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path  className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
              </svg>
          }
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setOpen(true) }}
          onFocus={() => { if (items.length > 0) setOpen(true) }}
          onKeyDown={onKeyDown}
          placeholder="Search item code or description…"
          autoComplete="off"
          className="flex-1 px-3 py-3 text-sm text-sap-text-1 placeholder-gray-400 bg-transparent outline-none"
        />

        {value && (
          <button type="button" onClick={clear} aria-label="Clear"
            className="pr-3 text-sap-text-2 hover:text-sap-error transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {showDrop && (
        <div className="absolute z-50 w-full bg-white border-2 border-t-0 border-sap-blue rounded-b-lg shadow-sap-md overflow-hidden">

          {items.length > 0 ? (
            <>
              {/* Header row */}
              <div className="grid grid-cols-[9rem_1fr_7rem] gap-2 px-4 py-1.5 bg-sap-bg border-b border-sap-border">
                <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide">Code</span>
                <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide">Description</span>
                <span className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide text-right">Price</span>
              </div>

              {/* Rows */}
              <ul className="max-h-60 overflow-y-auto divide-y divide-gray-50">
                {items.map((item, idx) => (
                  <li key={item.itemCode}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => select(item)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full grid grid-cols-[9rem_1fr_7rem] gap-2 items-center px-4 py-2.5 text-left transition-colors
                        ${idx === activeIdx ? 'bg-sap-blue-lt' : 'hover:bg-sap-bg'}`}
                    >
                      <span className="text-xs font-mono font-semibold text-sap-blue truncate">
                        {item.itemCode}
                      </span>
                      <span className="text-sm text-sap-text-1 truncate">{item.itemName}</span>
                      <div className="text-right">
                        <p className="text-sm font-bold text-sap-text-1 tabular-nums">
                          {fmt(item.price, item.currency)}
                        </p>
                        {item.lastSoldPrice != null && item.lastSoldPrice !== item.price && (
                          <p className="text-xs text-sap-text-2 line-through tabular-nums">
                            {fmt(item.lastSoldPrice, item.currency)}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-1.5 bg-sap-bg border-t border-sap-border">
                <span className="text-xs text-sap-text-2">{items.length} item{items.length !== 1 ? 's' : ''} found</span>
                <span className="text-xs text-sap-text-2 hidden sm:block">↑↓ navigate · Enter select · Esc close</span>
              </div>
            </>
          ) : !isSearching ? (
            <div className="px-4 py-6 text-center">
              <svg className="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/>
              </svg>
              <p className="text-sm text-sap-text-2">
                No items found for <span className="font-semibold text-sap-text-1">"{value}"</span>
              </p>
            </div>
          ) : (
            <div className="px-4 py-4 text-center text-sm text-sap-text-2">Searching…</div>
          )}
        </div>
      )}
    </div>
  )
}
