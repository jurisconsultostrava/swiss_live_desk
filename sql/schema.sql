-- Swiss Gold Market Board database model for Railway PostgreSQL
create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  external_ref text unique,
  email text unique not null,
  username text unique,
  full_name text not null,
  role text not null default 'client' check (role in ('client','dealer','admin')),
  kyc_status text not null default 'pending' check (kyc_status in ('pending','verified','blocked')),
  account_status text not null default 'active' check (account_status in ('active','watch','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists client_cash_balances (
  user_id uuid references app_users(id) on delete cascade,
  currency text not null check (currency in ('CZK','EUR','CHF','USD','GBP')),
  available numeric(22,6) not null default 0,
  reserved numeric(22,6) not null default 0,
  primary key (user_id, currency)
);

create table if not exists client_metal_holdings (
  user_id uuid references app_users(id) on delete cascade,
  metal text not null check (metal in ('AU','AG','PT','PD')),
  location text not null,
  total_g numeric(22,6) not null default 0,
  reserved_g numeric(22,6) not null default 0,
  custody_status text not null default 'in_custody',
  primary key (user_id, metal, location)
);

create table if not exists account_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  card_key text not null,
  card_type text not null,
  title_cs text not null,
  title_en text,
  sort_order int not null default 100,
  is_enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  unique (user_id, card_key)
);

create table if not exists account_settings (
  user_id uuid primary key references app_users(id) on delete cascade,
  valuation_currency text not null default 'CZK',
  timezone text not null default 'Europe/Prague',
  language text not null default 'cs',
  trading_silver_enabled boolean not null default true,
  trading_platinum_enabled boolean not null default true,
  trading_palladium_enabled boolean not null default true,
  two_factor_status text not null default 'not_active',
  login_alerts_email boolean not null default true,
  order_alerts_email boolean not null default true,
  statements_delivery text not null default 'online_and_email',
  updated_at timestamptz not null default now()
);

create table if not exists client_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  side text not null check (side in ('BUY','SELL')),
  market_key text not null,
  metal text not null check (metal in ('AU','AG','PT','PD')),
  location text,
  currency text not null,
  quantity numeric(22,6) not null,
  unit text not null default 'TOZ',
  limit_price numeric(22,6) not null,
  order_type text not null default 'TIL_CANCEL',
  status text not null default 'pending' check (status in ('draft','pending','approved','matched','rejected','cancelled')),
  gross_value numeric(22,6) not null default 0,
  fee_value numeric(22,6) not null default 0,
  total_value numeric(22,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists metal_price_snapshots (
  id bigserial primary key,
  metal text not null check (metal in ('AU','AG','PT','PD')),
  currency text not null check (currency in ('CZK','EUR','CHF','USD','GBP')),
  price_toz numeric(22,6) not null,
  source text not null default 'demo',
  captured_at timestamptz not null default now()
);
create index if not exists idx_price_snapshots_lookup on metal_price_snapshots(metal, currency, captured_at desc);

create table if not exists market_spread_snapshots (
  id bigserial primary key,
  market_key text not null,
  metal text not null check (metal in ('AU','AG','PT','PD')),
  location text not null,
  currency text not null,
  spot_toz numeric(22,6) not null,
  best_bid_toz numeric(22,6) not null,
  best_offer_toz numeric(22,6) not null,
  spread_abs numeric(22,6) not null,
  spread_pct numeric(12,6) not null,
  bid_quantity_toz numeric(22,6) not null default 0,
  offer_quantity_toz numeric(22,6) not null default 0,
  captured_at timestamptz not null default now()
);
create index if not exists idx_spread_snapshots_lookup on market_spread_snapshots(market_key, captured_at desc);

create table if not exists audit_log (
  id bigserial primary key,
  user_id uuid references app_users(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
