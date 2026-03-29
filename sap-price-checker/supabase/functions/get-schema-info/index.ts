/**
 * Supabase Edge Function: get-schema-info
 *
 * Returns Supabase database schema info — table names, row counts,
 * column details for display in the Price Checker UI.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(supabaseUrl, supabaseKey)

  try {
    // Get table info from information_schema
    const { data: tables, error: tablesErr } = await db.rpc('get_schema_info').select()

    if (tablesErr) {
      // Fallback: query information_schema directly
      const { data: rawTables } = await db
        .from('price_cache')
        .select('*', { count: 'exact', head: true })

      const priceCacheCount = rawTables ?? 0

      return json({
        database: supabaseUrl.split('//')[1]?.split('.')[0] ?? 'unknown',
        schema: 'public',
        tables: [
          {
            name: 'price_cache',
            rowCount: priceCacheCount,
            columns: [
              'id', 'item_code', 'item_name', 'price',
              'last_sold_price', 'discount', 'price_list_name',
              'currency', 'updated_at'
            ],
          },
        ],
        lastSync: new Date().toISOString(),
      })
    }

    return json({
      database: supabaseUrl.split('//')[1]?.split('.')[0] ?? 'unknown',
      schema: 'public',
      tables,
      lastSync: new Date().toISOString(),
    })
  } catch (err) {
    console.error('get-schema-info error:', err)
    return json({
      database: supabaseUrl.split('//')[1]?.split('.')[0] ?? 'unknown',
      schema: 'public',
      tables: [{ name: 'price_cache', rowCount: 0, columns: [] }],
      lastSync: new Date().toISOString(),
    })
  }
})
