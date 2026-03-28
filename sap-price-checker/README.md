# SAP Price Checker

A quick item price checker for SAP Business One, packaged as both a **SAP Webclient Extension** and a **standalone Progressive Web App**.

Built with React + Vite, Tailwind CSS, Supabase Edge Functions, and the SAP B1 Service Layer REST API.

---

## How it works

The app supports two auth modes that are detected automatically:

| Mode | When | How |
|------|------|-----|
| **A — SAP Webclient (SSO)** | Running inside SAP B1 Webclient iframe | Reads `window.sap.b1.context` silently — no login screen |
| **B — Standalone** | Hosted on Vercel/Netlify or opened directly | User enters SAP credentials → Edge Function → SAP Service Layer |

In both modes the session token lives **only in React state** — never in `localStorage`, `sessionStorage`, or cookies. Any 401 response clears the session and shows the login form with the message "Your session expired. Please log in again."

---

## Prerequisites

- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g supabase`)
- A running SAP Business One server with Service Layer enabled (port 50000 by default)
- A Supabase project (free tier works)

---

## Local setup

```bash
# 1. Clone / enter the project
cd sap-price-checker

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 4. Start the dev server
npm run dev
```

Open `http://localhost:5173` — you will see the standalone login form.

---

## Supabase project setup

### 1. Create a project

Log in to [supabase.com](https://supabase.com) and create a new project. Copy the **Project URL** and **anon public key** from *Settings → API* into your `.env` file.

### 2. Link the CLI

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 3. Run the migration

```bash
supabase db push
```

This creates the `price_cache` table with the correct indexes and RLS policy. Verify in the Supabase Table Editor.

> **Note:** The migration uses the `pg_trgm` extension for name-search indexing. This extension is enabled by default on Supabase. If you see an error, enable it manually:
> ```sql
> create extension if not exists pg_trgm;
> ```

---

## Set Edge Function secrets

The SAP Service Layer URL must **never** appear in the frontend bundle. Set it as a server-side secret:

```bash
supabase secrets set SAP_SERVICE_LAYER_URL=https://your-sap-server:50000
```

Verify:

```bash
supabase secrets list
```

---

## Deploy Edge Functions

```bash
npm run deploy:functions
```

This is equivalent to:

```bash
supabase functions deploy sap-login
supabase functions deploy get-item-price
```

After deployment, test `sap-login` with curl:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/sap-login \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username":"manager","password":"your_password","companyDB":"SBODemoGB"}'
```

You should receive `{"sessionToken":"...","companyDB":"SBODemoGB"}`.

---

## Build the SAP Webclient extension

```bash
npm run build:extension
```

This runs `vite build` (outputs to `dist/`) then copies the SAP extension manifest:

```
dist/
  index.html
  assets/
    index-[hash].js    ← single bundle, no code splitting
  manifest.json        ← SAP Webclient extension manifest (id: com.mycompany.priceChecker)
  manifest.json        ← PWA manifest (in public/)
  sw.js
```

---

## Install in SAP B1 Webclient

1. Build the extension: `npm run build:extension`
2. Locate the SAP Webclient extensions folder on your SAP server.
   Default path (Windows): `C:\Program Files\SAP\SAP Business One\WebClient\Extensions\`
3. Copy the entire `dist/` folder into that directory and rename it to **`com.mycompany.priceChecker`**:
   ```
   Extensions/
     com.mycompany.priceChecker/
       index.html
       manifest.json
       assets/
       sw.js
   ```
4. Restart the **SAP Business One Webclient** Windows service.
5. Open SAP Webclient, go to **Administration → Extensions Manager**.
6. Find **Price Checker** and click **Enable**.
7. The extension will appear in the Webclient sidebar or tile area. Because `ssoEnabled: true` is set in the manifest and `trustedApp: true` is declared, SAP Webclient injects the user's session into `window.sap.b1.context` — the app picks this up silently and skips the login screen entirely (Mode A).

---

## Run as a standalone PWA

1. Build: `npm run build:extension`
2. Deploy the `dist/` folder to **Vercel**, **Netlify**, or any static host:

   **Vercel:**
   ```bash
   npx vercel dist --prod
   ```

   **Netlify:**
   ```bash
   npx netlify-cli deploy --dir dist --prod
   ```

3. Open the deployed URL in a browser and click "Add to Home Screen" (or "Install app" in the browser menu) to install the PWA.
4. The app will show the login form (Mode B). Users enter their normal SAP B1 credentials — no separate accounts are needed.

---

## Session expiry behaviour

**For end users:**

- SAP Business One sessions have a configurable timeout (default: 30 minutes of inactivity).
- If you are searching and suddenly see the login screen with the message **"Your session expired. Please log in again."**, your SAP session timed out.
- Simply sign in again with the same credentials. Your previous work is not lost — the price cache persists in Supabase.

**For administrators:**

- The session timeout is controlled in SAP B1: *Administration → System Initialization → General Settings → Services tab*.
- Passwords are **never stored anywhere** by this application. They pass through the Supabase Edge Function in memory only, for the duration of the login request.

---

## Environment variables reference

| Variable | Where | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` (frontend) | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env` (frontend) | Supabase anon/public key |
| `SAP_SERVICE_LAYER_URL` | Supabase secret | Full URL to SAP Service Layer e.g. `https://sap-server:50000` |

---

## Project structure

```
sap-price-checker/
├── public/
│   ├── manifest.json          PWA manifest
│   └── sw.js                  Service Worker (offline support)
├── src/
│   ├── lib/
│   │   ├── sapAuth.js         SSO detection + login helpers
│   │   └── supabase.js        Supabase client singleton
│   ├── components/
│   │   ├── LoginForm.jsx      Mode B credential form
│   │   ├── SearchBar.jsx      Debounced search input
│   │   └── PriceCard.jsx      Item price display card
│   ├── App.jsx                Root component / orchestration
│   ├── main.jsx               React entry point + SW registration
│   └── index.css              Tailwind directives
├── supabase/
│   ├── functions/
│   │   ├── sap-login/         POST credentials → SAP → return session token
│   │   └── get-item-price/    GET item prices from SAP + cache to Supabase
│   └── migrations/
│       └── 001_price_cache.sql
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── manifest.json              SAP Webclient extension manifest
├── package.json
└── .env.example
```
