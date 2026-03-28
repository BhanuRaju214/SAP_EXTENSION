import { useState } from 'react'

const CURRENCY_MAP = { '$':'USD','€':'EUR','£':'GBP','¥':'JPY','₹':'INR','₩':'KRW' }

function normCurrency(raw) {
  if (!raw) return 'USD'
  if (CURRENCY_MAP[raw]) return CURRENCY_MAP[raw]
  return /^[A-Z]{3}$/.test(raw) ? raw : 'USD'
}

function fmt(val, raw) {
  if (val == null || val === '') return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: normCurrency(raw),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(val)
  } catch {
    return `${raw || '$'}${Number(val).toFixed(2)}`
  }
}

export default function PriceCard({ item }) {
  const [copied, setCopied] = useState(false)

  if (!item) return null

  const { itemCode, itemName, price, lastSoldPrice, discount, priceListName, currency } = item

  const hasLastSold = lastSoldPrice != null && lastSoldPrice > 0
  const priceBetter = hasLastSold && Number(price) < Number(lastSoldPrice)
  const priceHigher = hasLastSold && Number(price) > Number(lastSoldPrice)

  async function copy() {
    try { await navigator.clipboard.writeText(String(price)) }
    catch {
      const el = Object.assign(document.createElement('textarea'), { value: String(price) })
      Object.assign(el.style, { position:'fixed', opacity:'0' })
      document.body.appendChild(el); el.select()
      document.execCommand('copy'); document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white rounded-lg border border-sap-border shadow-sap-sm overflow-hidden">

      {/* ── Object header ── */}
      <div className="bg-sap-shell px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-mono font-semibold text-blue-300 tracking-wider uppercase mb-0.5">
            {itemCode}
          </p>
          <h2 className="text-white font-semibold text-base leading-snug">{itemName}</h2>
          {priceListName && <p className="text-blue-200 text-xs mt-1">{priceListName}</p>}
        </div>

        <div className="flex-shrink-0 mt-0.5">
          {priceBetter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
              Better Price
            </span>
          )}
          {priceHigher && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              Price Increased
            </span>
          )}
        </div>
      </div>

      {/* ── Price tiles ── */}
      <div className="p-5">
        <div className="grid grid-cols-2 gap-4 mb-4">

          <div className="bg-sap-blue-lt border border-blue-100 rounded-lg p-4">
            <p className="text-xs font-semibold text-sap-blue uppercase tracking-wide mb-1">List Price</p>
            <p className="text-2xl font-bold text-sap-shell tabular-nums leading-none">
              {fmt(price, currency)}
            </p>
            <p className="text-xs text-sap-text-2 mt-1 truncate">{priceListName || 'Standard'}</p>
          </div>

          <div className={`rounded-lg p-4 border ${hasLastSold ? 'bg-gray-50 border-sap-border' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
            <p className="text-xs font-semibold text-sap-text-2 uppercase tracking-wide mb-1">Last Sold</p>
            <p className={`text-2xl font-bold tabular-nums leading-none ${hasLastSold ? 'text-sap-text-1' : 'text-gray-300'}`}>
              {hasLastSold ? fmt(lastSoldPrice, currency) : '—'}
            </p>
            {hasLastSold
              ? <p className="text-xs text-sap-text-2 mt-1">from last invoice</p>
              : <p className="text-xs text-gray-400 mt-1">no sales history</p>
            }
          </div>
        </div>

        {/* Discount */}
        {discount != null && discount > 0 && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z"/>
            </svg>
            <span className="text-sm font-semibold text-amber-700">{Number(discount).toFixed(1)}% discount</span>
            <span className="text-sm text-sap-text-2">on last invoice</span>
          </div>
        )}

        {/* Copy button */}
        <button onClick={copy} type="button"
          className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded border text-sm font-semibold transition-all
            focus:outline-none focus:ring-2 focus:ring-sap-blue focus:ring-offset-1
            ${copied
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'bg-white border-sap-blue text-sap-blue hover:bg-sap-blue-lt active:bg-blue-100'}`}
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
              Copy Price
            </>
          )}
        </button>
      </div>
    </div>
  )
}
