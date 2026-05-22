-- ══════════════════════════════════════════════════════════════
-- Supabase migration: tạo bảng vn_market_data
-- Chạy trong Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

create table if not exists public.vn_market_data (
  id         bigserial primary key,
  symbol     text        not null,
  sector     text        not null,
  date       date        not null,
  close      numeric,
  volume     bigint,          -- khối lượng cổ phiếu
  value      numeric,         -- giá trị khớp (VND) ≈ close * volume
  created_at timestamptz default now(),

  unique (symbol, date)
);

-- Index để query nhanh theo date
create index if not exists idx_vn_market_data_date   on public.vn_market_data(date desc);
create index if not exists idx_vn_market_data_symbol on public.vn_market_data(symbol);
create index if not exists idx_vn_market_data_sector on public.vn_market_data(sector);

-- RLS: cho phép anon read
alter table public.vn_market_data enable row level security;

create policy "Allow anon read"
  on public.vn_market_data
  for select
  to anon
  using (true);
