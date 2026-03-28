-- Migration: 001_price_cache
-- Creates the price_cache table used by the get-item-price Edge Function to
-- persist SAP item pricing data for offline access and performance.

-- Required for partial-name search index
create extension if not exists pg_trgm;

create table if not exists price_cache (
  id               uuid        primary key default gen_random_uuid(),
  item_code        text        not null unique,
  item_name        text        not null,
  price            numeric(15, 4) not null default 0,
  last_sold_price  numeric(15, 4),
  discount         numeric(5, 2),
  price_list_name  text,
  currency         text        not null default 'USD',
  updated_at       timestamptz not null default now()
);

-- Fast lookup by item code (primary search key)
create index if not exists idx_price_cache_item_code
  on price_cache (item_code);

-- Useful for cache-staleness checks / admin queries
create index if not exists idx_price_cache_updated_at
  on price_cache (updated_at desc);

-- Partial-name search support
create index if not exists idx_price_cache_item_name_trgm
  on price_cache using gin (item_name gin_trgm_ops);

-- Row-level security: Edge Functions use the service role key and bypass RLS.
-- The anon / authenticated roles must NOT be able to read raw price data
-- directly from the table (they go through the Edge Function only).
alter table price_cache enable row level security;

-- No RLS policies are created here — the table is intentionally inaccessible
-- to browser clients. Access is exclusively through the Edge Function which
-- uses the service role key.

comment on table price_cache is
  'Cache of SAP B1 item prices fetched via the get-item-price Edge Function';
comment on column price_cache.item_code is
  'SAP item code — unique natural key used for upserts';
comment on column price_cache.price is
  'Current list price from SAP (primary price list)';
comment on column price_cache.last_sold_price is
  'Unit price from the most recent A/R invoice line for this item';
comment on column price_cache.discount is
  'Discount percentage from the most recent invoice line (nullable)';
comment on column price_cache.updated_at is
  'Timestamp of the last successful cache refresh from SAP';
