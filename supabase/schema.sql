create table if not exists public.stock_snapshots (
  code text primary key,
  name text not null,
  secucode text not null,
  query text not null,
  fetched_at timestamptz not null,
  payload jsonb not null
);

create index if not exists idx_stock_snapshots_query
  on public.stock_snapshots(query);

create index if not exists idx_stock_snapshots_name
  on public.stock_snapshots(name);

create index if not exists idx_stock_snapshots_secucode
  on public.stock_snapshots(secucode);

create table if not exists public.treasury_yields (
  date date primary key,
  cn_2y double precision,
  cn_5y double precision,
  cn_10y double precision,
  cn_30y double precision,
  us_10y double precision,
  fetched_at timestamptz not null
);

create table if not exists public.market_temperature_rows (
  category text not null,
  trade_date date not null,
  code text not null,
  name text not null,
  quote_id text not null,
  rank integer not null,
  change_percent double precision,
  close double precision,
  ma20 double precision,
  deviation_percent double precision,
  volume_ratio double precision,
  state_change_date date,
  interval_change_percent double precision,
  rank_change integer not null default 0,
  fetched_at timestamptz not null,
  primary key (category, trade_date, code)
);

create index if not exists idx_market_temperature_latest
  on public.market_temperature_rows(category, trade_date desc, rank);
