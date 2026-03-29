# SAP B1 Price Checker — Technical Documentation

A Web Client extension for SAP Business One that provides quick item price lookup with last-sold-price comparison. Built with React + Vite, Tailwind CSS, Supabase Edge Functions, and SAP B1 Service Layer REST API v2.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How the Two Modes Work](#2-how-the-two-modes-work)
3. [Step-by-Step: What Happens When the App Loads](#3-step-by-step-what-happens-when-the-app-loads)
4. [Authentication & Session Management](#4-authentication--session-management)
5. [How Search Works — Data Flow](#5-how-search-works--data-flow)
6. [Database Connections](#6-database-connections)
7. [File-by-File Explanation](#7-file-by-file-explanation)
8. [SAP Service Layer API Calls](#8-sap-service-layer-api-calls)
9. [Supabase Edge Functions](#9-supabase-edge-functions)
10. [Content Security Policy (CSP) Solution](#10-content-security-policy-csp-solution)
11. [Build & Packaging](#11-build--packaging)
12. [Deployment](#12-deployment)
13. [Environment Variables & Secrets](#13-environment-variables--secrets)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   SAP B1 Web Client                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │          Price Checker Extension (iframe)              │  │
│  │                                                       │  │
│  │   React App (Vite + Tailwind)                         │  │
│  │     │                                                 │  │
│  │     ├── Mode A: Direct SAP API ──────────────────┐    │  │
│  │     │   (same-origin, no CSP issue)              │    │  │
│  │     │                                            ▼    │  │
│  │     │                              ┌──────────────┐   │  │
│  │     │                              │ SAP Service  │   │  │
│  │     │                              │ Layer v2     │   │  │
│  │     │                              │ /b1s/v2/*    │   │  │
│  │     │                              └──────────────┘   │  │
│  │     │                                                 │  │
│  │     └── Mode B: Supabase ──────┐                      │  │
│  │         (standalone only)      │                      │  │
│  └────────────────────────────────│───────────────────────┘  │
└───────────────────────────────────│──────────────────────────┘
                                    │
                                    ▼
                        ┌─────────────────────┐
                        │  Supabase Cloud      │
                        │  ┌───────────────┐   │
                        │  │ Edge Functions │   │
                        │  │ - sap-login    │───┼──► SAP Service Layer
                        │  │ - get-item-    │   │    (https://cac-sl.sbocloud.pro)
                        │  │   price        │   │
                        │  │ - get-schema-  │   │
                        │  │   info         │   │
                        │  └───────────────┘   │
                        │  ┌───────────────┐   │
                        │  │ PostgreSQL DB  │   │
                        │  │ - price_cache  │   │
                        │  └───────────────┘   │
                        └─────────────────────┘
```

### Three systems are involved:

| System | Role | URL |
|---|---|---|
| **SAP B1 Service Layer** | Source of truth — items, prices, invoices | `https://cac-sl.sbocloud.pro/b1s/v2/` |
| **Supabase** | API proxy (standalone mode) + price cache DB | `https://stketabfgrcblcrcjauc.supabase.co` |
| **React App** | Frontend UI — runs in browser | Built with Vite, deployed as `.mtar` |

---

## 2. How the Two Modes Work

### Mode A — Inside SAP Web Client (Direct API)

```
User clicks "Price Checker" tile
  → Extension loads in an iframe
  → App detects it's inside SAP Web Client
  → Reuses the user's existing SAP session (cookies)
  → Calls SAP Service Layer DIRECTLY at the same origin
  → No Supabase needed for API calls
  → No login screen shown
```

**Why this mode exists:** SAP Web Client enforces a Content Security Policy (CSP) that blocks connections to external domains like `*.supabase.co`. By calling the SAP Service Layer directly (same origin), we bypass CSP entirely.

### Mode B — Standalone (Netlify / localhost)

```
User opens the app in a browser
  → App detects it's NOT inside SAP Web Client
  → Shows login form (SAP username, password, company DB)
  → Sends credentials to Supabase Edge Function "sap-login"
  → Edge Function calls SAP Service Layer, returns session token
  → App stores token in React state (never in localStorage)
  → Search calls go through Supabase Edge Function "get-item-price"
```

**Why this mode exists:** When running outside SAP, the browser can't reach the SAP server directly (different domain, CORS). Supabase Edge Functions act as a server-side proxy.

---

## 3. Step-by-Step: What Happens When the App Loads

### 3.1 Entry Point

```
index.html
  → loads src/main.jsx
    → registers Service Worker (public/sw.js)
    → renders <App /> component
```

### 3.2 App.jsx Mount Sequence

```javascript
// Step 1: App component mounts
useEffect(() => {
  getOrCreateSession()  // from src/lib/sapAuth.js
}, [])
```

### 3.3 Session Detection Cascade (sapAuth.js)

The `getOrCreateSession()` function runs this cascade:

```
Step 1: Is this inside SAP Web Client?
  ├── Check URL for /extn/, /webclient/, /ui-static/
  ├── Check window.sap.b1.context
  └── Check window.parent.sap.b1.context
  │
  ├── NO → return null → App shows LoginForm (Mode B)
  │
  └── YES → Continue to Step 2
          │
          Step 2: Try SSO context object
          ├── Read window.sap.b1.context.sessionToken
          ├── Read window.sap.b1.context.companyDB
          ├── Read window.sap.b1.context.username
          │
          ├── FOUND → Return session → App shows SearchBar immediately
          │
          └── NOT FOUND → Continue to Step 3
                  │
                  Step 3: Probe existing SAP cookies
                  ├── POST /b1s/v2/CompanyService_GetCompanyInfo
                  │   with credentials:'include' (sends B1SESSION cookie)
                  │
                  ├── SUCCESS → Extract CompanyDB → Return session
                  │
                  └── FAIL → Try GET /b1s/v2/Items?$top=1
                          │
                          ├── SUCCESS → Return session with detected CompanyDB
                          │
                          └── FAIL → Continue to Step 4
                                  │
                                  Step 4: Detect CompanyDB from URL params
                                  │
                                  Step 5: Last resort — return cookie-session
                                  (user IS inside Web Client, never show login)
```

### 3.4 After Session is Established

```
App.jsx receives session object
  → Renders shell bar with session info
  → Renders SearchBar component
  → Renders Connection Details panel
  → User types a search query
  → 300ms debounce fires
  → searchItems(query, session) called
```

---

## 4. Authentication & Session Management

### Session Object Shape

```javascript
{
  mode: 'webclient' | 'standalone',
  sapSession: {
    sessionToken: 'uuid-string' | 'cookie-session',
    companyDB: 'SBODEMOUS'
  },
  username: 'manager',
  useDirectAPI: true | false
}
```

### Security Rules

| Rule | Implementation |
|---|---|
| Password never stored | Cleared from React state immediately after login submit |
| Session token in memory only | Stored in React `useState`, never in `localStorage` or `sessionStorage` |
| Token never in URL | Passed in headers (`x-sap-session`) or cookies only |
| 401 clears everything | Any 401 response resets session state and shows login |

### Cookie-Based Session (Web Client Mode)

When inside SAP Web Client, the browser already has a `B1SESSION` cookie from the parent SAP session. The app uses `credentials: 'include'` on every `fetch()` call, which automatically sends this cookie to the SAP Service Layer. No explicit session token management is needed.

```javascript
// Every API call inside Web Client uses this:
fetch(`${origin}/b1s/v2/Items?...`, {
  credentials: 'include'  // ← sends B1SESSION cookie automatically
})
```

---

## 5. How Search Works — Data Flow

### 5.1 User Types "A00001"

```
SearchBar.jsx
  → onChange sets value state to "A00001"
  → useEffect starts 300ms debounce timer
  → After 300ms, calls onSearch("A00001")
  → App.jsx handleSearch("A00001") called
```

### 5.2 Mode A: Direct SAP API (inside Web Client)

```
searchDirect("A00001", session)
  │
  ├── Step 1: Build OData filter
  │   $filter = startswith(ItemCode,'A00001') or contains(ItemName,'A00001')
  │
  ├── Step 2: GET /b1s/v2/Items
  │   URL: /b1s/v2/Items?$filter=...&$select=ItemCode,ItemName,ItemPrices&$top=10
  │   Auth: credentials:'include' (uses existing B1SESSION cookie)
  │   Returns: Array of items with ItemPrices sub-array
  │
  ├── Step 3: GET /b1s/v2/PriceLists(1)
  │   For each unique PriceList number, fetch the name
  │   Cached in a Map to avoid duplicate calls
  │   Returns: { PriceListName: "Base Price" }
  │
  ├── Step 4: GET /b1s/v2/Invoices (last sold price)
  │   URL: /b1s/v2/Invoices?$select=DocDate,DocumentLines&$orderby=DocDate desc&$top=20
  │   Fetches up to 60 recent invoices (3 pages × 20)
  │   Scans DocumentLines for matching ItemCode
  │   Builds a Map: ItemCode → { price, currency, discount }
  │
  │   WHY NOT use OData any() filter?
  │   SAP Service Layer v2 does NOT support lambda filters
  │   like DocumentLines/any(d: d/ItemCode eq 'A00001')
  │   So we fetch invoices in bulk and filter in JavaScript
  │
  └── Step 5: Build result objects
      For each item:
        - price = ItemPrices[PriceList 1].Price (or first non-zero)
        - lastSoldPrice = from invoice scan Map
        - discount = DiscountPercent from invoice line
        - currency = normalized ($ → USD)
        - priceListName = from PriceLists endpoint
      Returns: Array of PriceResult objects
```

### 5.3 Mode B: Via Supabase Edge Function (standalone)

```
searchViaSupabase("A00001", session)
  │
  ├── GET https://stketabfgrcblcrcjauc.supabase.co/functions/v1/get-item-price
  │   Query: ?search=A00001
  │   Headers:
  │     Authorization: Bearer <supabase-anon-key>
  │     x-sap-session: <session-token>
  │     x-sap-company: SBODEMOUS
  │
  ├── Edge Function (get-item-price/index.ts) runs on Deno:
  │   ├── Reads x-sap-session and x-sap-company headers
  │   ├── Calls SAP Service Layer (same flow as Mode A)
  │   │   URL: https://cac-sl.sbocloud.pro/b1s/v2/Items?...
  │   │   Auth: Cookie: B1SESSION=<token>; CompanyDB=SBODEMOUS
  │   ├── Builds result array
  │   ├── Writes to price_cache table (async, fire-and-forget)
  │   └── Returns JSON response
  │
  └── React app receives JSON array of PriceResult objects
```

### 5.4 Result Display

```
App.jsx receives results array
  → Sets searchResults state
  → SearchBar.jsx renders dropdown:
      ┌──────────────────────────────────────────┐
      │ CODE        DESCRIPTION          PRICE   │
      ├──────────────────────────────────────────┤
      │ A00001  6.6 CUFT FREEZER      $400.00   │
      │ AA00001 AA00001                $200.00   │
      ├──────────────────────────────────────────┤
      │ 2 items found      ↑↓ Enter Esc         │
      └──────────────────────────────────────────┘

User clicks a row
  → SearchBar calls onSelect(item)
  → App.jsx sets selectedItem state
  → PriceCard.jsx renders:
      ┌──────────────────────────────────────────┐
      │ A00001           [Price Increased badge] │
      │ 6.6 CUFT FREEZER                        │
      │ Base Price                               │
      ├──────────────────────────────────────────┤
      │ LIST PRICE     │ LAST SOLD              │
      │ $400.00        │ $600.00                │
      │ Base Price     │ from last invoice      │
      ├──────────────────────────────────────────┤
      │ [ Copy Price ]                           │
      └──────────────────────────────────────────┘
```

---

## 6. Database Connections

### 6.1 SAP HANA Database (via Service Layer)

The app NEVER connects to SAP HANA directly. All data access goes through the **SAP Service Layer REST API**, which is a middleware layer that handles authentication, authorization, and SQL generation.

```
React App → SAP Service Layer → SAP HANA
             (REST API v2)      (database)
             /b1s/v2/*          Tables: OITM, OINV, INV1, etc.
```

**OData endpoints used:**

| Endpoint | SQL equivalent | Purpose |
|---|---|---|
| `GET /b1s/v2/Items` | `SELECT * FROM OITM` | Get item details + prices |
| `GET /b1s/v2/PriceLists(n)` | `SELECT * FROM OPLN WHERE ListNum = n` | Get price list name |
| `GET /b1s/v2/Invoices` | `SELECT * FROM OINV JOIN INV1` | Get last sold price |
| `POST /b1s/v2/Login` | Session creation | Authenticate user |
| `POST /b1s/v2/CompanyService_GetCompanyInfo` | `SELECT * FROM OADM` | Get company DB name |

### 6.2 Supabase PostgreSQL Database

The Supabase database stores a **cache** of price data for offline access and performance.

**Connection:** Supabase Edge Functions use the `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) to write to the database. The browser NEVER connects to PostgreSQL directly.

```
Edge Function → Supabase PostgreSQL
(Deno runtime)   (database)
                  Table: price_cache
```

**Table: `price_cache`**

```sql
CREATE TABLE price_cache (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code        TEXT NOT NULL UNIQUE,    -- SAP item code (e.g. 'A00001')
  item_name        TEXT NOT NULL,           -- Item description
  price            NUMERIC(15,4) DEFAULT 0, -- Current list price
  last_sold_price  NUMERIC(15,4),           -- Price from last invoice
  discount         NUMERIC(5,2),            -- Discount % from last invoice
  price_list_name  TEXT,                    -- Name of the price list
  currency         TEXT DEFAULT 'USD',      -- ISO currency code
  updated_at       TIMESTAMPTZ DEFAULT now() -- Last cache refresh
);
```

**Indexes:**
- `idx_price_cache_item_code` — B-tree on `item_code` (fast exact lookup)
- `idx_price_cache_updated_at` — B-tree DESC on `updated_at` (staleness checks)
- `idx_price_cache_item_name_trgm` — GIN trigram on `item_name` (fuzzy search)

**RLS:** Enabled with NO policies — table is only accessible via Edge Functions using the service role key. Browser clients cannot query it directly.

**Cache write flow:**
```
get-item-price Edge Function
  → Fetches data from SAP
  → Returns data to browser
  → ALSO writes to price_cache (async, fire-and-forget)
  → Uses UPSERT with onConflict:'item_code'
  → Old data for same item is overwritten
```

---

## 7. File-by-File Explanation

### Frontend (React)

| File | Purpose | What it does |
|---|---|---|
| `index.html` | HTML entry point | Contains CSP meta tag to whitelist `*.supabase.co`. Loads Vite module. |
| `src/main.jsx` | React entry point | Registers service worker, mounts `<App />` into `#root` |
| `src/index.css` | Tailwind directives | Contains `@tailwind base/components/utilities` |
| `src/App.jsx` | Root component | Orchestrates everything: session init, search, routing between login/search/detail views |
| `src/lib/supabase.js` | Supabase client | Creates `@supabase/supabase-js` client using `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env` |
| `src/lib/sapAuth.js` | Auth + API layer | Session detection cascade, login (direct/Supabase), search (direct/Supabase), currency normalization |
| `src/components/LoginForm.jsx` | Login UI | SAP credential form with show/hide password, inline errors, connection info panel. Only shown in standalone mode |
| `src/components/SearchBar.jsx` | Search + dropdown | Debounced input (300ms), dropdown with item code/name/price columns, keyboard navigation (↑↓ Enter Esc) |
| `src/components/PriceCard.jsx` | Item detail card | Shows list price, last sold price, "Better Price"/"Price Increased" badge, discount, Copy button |

### Supabase Edge Functions (Deno)

| File | Endpoint | Purpose |
|---|---|---|
| `supabase/functions/sap-login/index.ts` | `POST /functions/v1/sap-login` | Proxies login to SAP Service Layer. Accepts `{username, password, companyDB}`, returns `{sessionToken, companyDB}` |
| `supabase/functions/get-item-price/index.ts` | `GET /functions/v1/get-item-price` | Proxies item search to SAP. Accepts `?search=` or `?itemCode=` + SAP session headers. Returns price data. Caches in `price_cache` |
| `supabase/functions/get-schema-info/index.ts` | `GET /functions/v1/get-schema-info` | Returns Supabase database metadata (project ref, schema, table info) |

### Database

| File | Purpose |
|---|---|
| `supabase/migrations/001_price_cache.sql` | Creates `price_cache` table, indexes, RLS, enables `pg_trgm` extension |

### Configuration

| File | Purpose |
|---|---|
| `vite.config.js` | Vite build config: React plugin, `base: './'` for relative paths, output to `build/`, single bundle (no code splitting) |
| `tailwind.config.js` | Tailwind theme: SAP Fiori/Horizon color palette, `72` font family, SAP shadow styles |
| `postcss.config.js` | PostCSS plugins: tailwindcss + autoprefixer |
| `package.json` | Dependencies and scripts: `dev`, `build`, `build:extension`, `deploy:functions` |
| `mta.yaml` | SAP MTA build descriptor: defines `price-checker` module as `single-page-app` with `deploy_mode: b1-webclient` |
| `.env.example` | Template for environment variables |
| `.env` | Actual Supabase URL + anon key (git-ignored) |

### SAP Web Client Extension

| File | Purpose |
|---|---|
| `manifest.json` (root) | SAP extension manifest with `id`, `version`, `entryPoint` |
| `public/manifest.json` | SAP extension manifest with `extensionPoints` array (tile definition) |
| `build/WebClientExtension.json` | Tile configuration for SAP Web Client: icon, title, subtitle, KPI endpoint |
| `public/pwa.manifest.json` | PWA manifest for standalone mode (name, icons, theme) |
| `public/sw.js` | Service Worker: cache app shell, serve offline, network-first for APIs |

---

## 8. SAP Service Layer API Calls

### Authentication

```http
POST /b1s/v2/Login
Content-Type: application/json

{
  "UserName": "manager",
  "Password": "manager",
  "CompanyDB": "SBODEMOUS"
}

Response 200:
{
  "SessionId": "bd4653f9-98f8-48f4-81ca-29caf11a8a09-2330",
  ...
}
```

### Item Search

```http
GET /b1s/v2/Items?$filter=startswith(ItemCode,'A00')%20or%20contains(ItemName,'A00')&$select=ItemCode,ItemName,ItemPrices&$top=10
Cookie: B1SESSION=<token>; CompanyDB=SBODEMOUS

Response 200:
{
  "value": [
    {
      "ItemCode": "A00001",
      "ItemName": "6.6 CUFT UPRIGHT FREEZER CUF66C1W",
      "ItemPrices": [
        { "PriceList": 1, "Price": 400.0, "Currency": "$" },
        { "PriceList": 2, "Price": 350.0, "Currency": "$" }
      ]
    }
  ]
}
```

### Price List Name

```http
GET /b1s/v2/PriceLists(1)?$select=PriceListNo,PriceListName
Cookie: B1SESSION=<token>

Response 200:
{ "PriceListNo": 1, "PriceListName": "Base Price" }
```

### Last Sold Price (Invoice Scan)

```http
GET /b1s/v2/Invoices?$select=DocDate,DocumentLines&$orderby=DocDate%20desc&$top=20
Cookie: B1SESSION=<token>

Response 200:
{
  "value": [
    {
      "DocDate": "2026-01-22T00:00:00Z",
      "DocumentLines": [
        {
          "ItemCode": "A00001",
          "Price": 600.0,
          "Currency": "$",
          "DiscountPercent": 0.0
        }
      ]
    }
  ]
}
```

**Note:** SAP Service Layer v2 does NOT support OData lambda filters (`any()`/`all()`) on navigation properties. That's why we fetch invoices in bulk and scan `DocumentLines` in JavaScript.

---

## 9. Supabase Edge Functions

### sap-login

```
Browser → POST /functions/v1/sap-login
           Body: { username, password, companyDB }
           │
           Edge Function (Deno) → POST https://cac-sl.sbocloud.pro/b1s/v2/Login
                                   Body: { UserName, Password, CompanyDB }
                                   │
                                   ├── 200 → Extract SessionId → Return { sessionToken, companyDB }
                                   ├── 401 → Return { error: 'invalid_credentials' } with 401
                                   └── Other → Return { error: 'sap_error' } with 502
```

### get-item-price

```
Browser → GET /functions/v1/get-item-price?search=A00001
           Headers: x-sap-session, x-sap-company
           │
           Edge Function → GET SAP Items
                         → GET SAP PriceLists
                         → GET SAP Invoices (last 60)
                         → Build result array
                         → UPSERT into price_cache (async)
                         → Return JSON
```

### Environment (auto-injected by Supabase runtime):
- `SUPABASE_URL` — used to create Supabase client for DB writes
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS for cache writes

### Secrets (set manually):
- `SAP_SERVICE_LAYER_URL` = `https://cac-sl.sbocloud.pro`

---

## 10. Content Security Policy (CSP) Solution

### The Problem

SAP Web Client sets a strict CSP header:
```
default-src 'self' *.sap.com *.hana.ondemand.com
```

This blocks all `fetch()` calls to `*.supabase.co`, causing "Failed to send request to Edge Function" errors.

### The Solution

Add a `<meta>` CSP tag in the extension's `index.html`:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
           connect-src 'self' https://*.supabase.co https://stketabfgrcblcrcjauc.supabase.co;
           script-src 'self' 'unsafe-inline' 'unsafe-eval';
           style-src 'self' 'unsafe-inline';
           img-src 'self' data: blob: https:;
           font-src 'self' data: https:;
           worker-src 'self' blob:;" />
```

This works because the extension runs in an **iframe** — the meta tag applies to the iframe's content scope.

### Fallback

If the server-level CSP overrides the meta tag (stricter server wins), the app automatically falls back to calling SAP Service Layer directly (same-origin, no CSP issue). This detection happens in `getOrCreateSession()`.

---

## 11. Build & Packaging

### Local Development

```bash
npm run dev    # Starts Vite dev server at http://localhost:5173
```

### Production Build

```bash
npm run build  # Outputs to build/ folder
```

Vite config ensures:
- `base: './'` — relative asset paths (required for SAP extension loading)
- `inlineDynamicImports: true` — single JS bundle, no code splitting
- Output: `build/assets/index-[hash].js` + `build/assets/index-[hash].css`

### MTA Archive (.mtar) for SAP Web Client

```bash
mbt build   # Creates mta_archives/com-mycompany-pricechecker_1.0.0.mtar
```

The `.mtar` contains:
```
META-INF/MANIFEST.MF
META-INF/mtad.yaml
price-checker/data.zip
  ├── index.html
  ├── WebClientExtension.json
  ├── manifest.json
  ├── sw.js
  ├── pwa.manifest.json
  └── assets/
      ├── index-[hash].js
      └── index-[hash].css
```

`mta.yaml` tells the MTA build tool:
```yaml
_schema-version: "3.2"
ID: com-mycompany-pricechecker
version: 1.0.0
modules:
- name: price-checker
  type: single-page-app
  path: build                    # ← package everything in build/
parameters:
  deploy_mode: b1-webclient      # ← target SAP B1 Web Client
```

---

## 12. Deployment

### Deploy Edge Functions

```bash
supabase functions deploy sap-login
supabase functions deploy get-item-price
supabase functions deploy get-schema-info
```

### Set SAP Secret

```bash
supabase secrets set SAP_SERVICE_LAYER_URL=https://cac-sl.sbocloud.pro
```

### Run Database Migration

```bash
supabase db push    # Creates price_cache table
```

### Deploy to SAP Web Client

1. Run `npm run build` then `mbt build`
2. Open SAP Web Client → Extension Manager
3. Import → Browse → select `com-mycompany-pricechecker_1.0.0.mtar`
4. Upload → Next → Finish
5. Company Assignment tab → assign to your company
6. The "Price Checker" tile appears on the Web Client home screen

### Deploy as Standalone PWA

```bash
npx vercel build/ --prod
# or
npx netlify-cli deploy --dir build --prod
```

---

## 13. Environment Variables & Secrets

### Frontend (.env file)

| Variable | Value | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://stketabfgrcblcrcjauc.supabase.co` | `src/lib/supabase.js` — creates Supabase client |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` (JWT) | `src/lib/supabase.js` — anonymous auth |

These are embedded in the JS bundle at build time by Vite (`import.meta.env.VITE_*`). They are **public** keys — the anon key only grants access to Edge Functions, not direct DB access.

### Supabase Secrets (server-side only)

| Secret | Value | Used by |
|---|---|---|
| `SAP_SERVICE_LAYER_URL` | `https://cac-sl.sbocloud.pro` | Edge Functions — to call SAP |
| `SUPABASE_URL` | (auto-injected) | Edge Functions — to write to DB |
| `SUPABASE_SERVICE_ROLE_KEY` | (auto-injected) | Edge Functions — bypasses RLS |

The `SAP_SERVICE_LAYER_URL` is **never** exposed to the browser. It exists only in the Edge Function runtime.

---

## 14. Troubleshooting

### "Failed to send a request to the Edge Function"
**Cause:** CSP blocks `*.supabase.co` inside SAP Web Client.
**Fix:** The CSP meta tag in `index.html` should whitelist it. If still blocked, the app falls back to direct SAP API automatically.

### "Your session expired. Please log in again."
**Cause:** SAP session timed out (default: 30 minutes).
**Fix:** Just sign in again. Timeout is configured in SAP → Administration → System Initialization → General Settings → Services.

### Dropdown shows but items are empty
**Cause:** SAP returned 0 items for the search query.
**Fix:** Try a broader search term. The filter uses `startswith(ItemCode)` and `contains(ItemName)`.

### Last sold price shows "—"
**Cause:** No invoices found containing that item in the last 60 invoices.
**Fix:** This is correct — the item simply hasn't been sold recently.

### Blank page after selecting an item
**Cause:** Currency value from SAP (e.g. `"$"`) crashes `Intl.NumberFormat`.
**Fix:** Already fixed — `normCurrency()` maps `$ → USD`, `€ → EUR`, etc. with try/catch fallback.

### Service Worker caching stale code
**Fix:** Open DevTools → Application → Service Workers → Unregister. Then Ctrl+Shift+R to hard refresh.
