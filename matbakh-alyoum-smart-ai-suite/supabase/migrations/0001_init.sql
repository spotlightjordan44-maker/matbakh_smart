create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  whatsapp_phone text not null unique,
  full_name text,
  notes text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_sessions (
  whatsapp_phone text primary key,
  state text not null default 'idle',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_categories (
  id text primary key,
  slug text not null unique,
  name text not null,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id text primary key,
  category_id text not null references public.menu_categories(id) on delete cascade,
  sku text,
  title text not null,
  description text,
  unit_label text,
  base_price numeric(12,2) not null default 0,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_zones (
  id text primary key,
  name text not null,
  delivery_fee numeric(12,2) not null default 0,
  min_eta_minutes int,
  max_eta_minutes int,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_phone text not null,
  customer_name text,
  status text not null default 'PENDING_ADMIN' check (status in ('PENDING_ADMIN', 'APPROVED', 'REJECTED', 'CANCELLED')),
  approval_mode text check (approval_mode in ('MANUAL', 'AUTO')),
  order_channel text not null default 'WHATSAPP',
  delivery_method text not null check (delivery_method in ('DELIVERY', 'PICKUP')),
  schedule_type text not null check (schedule_type in ('same_day', 'another_day')),
  requested_date date not null,
  requested_time_slot text not null,
  delivery_zone_id text references public.delivery_zones(id),
  delivery_zone_name text,
  address_text text,
  notes text,
  subtotal_amount numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  currency_code text not null default 'JOD',
  draft_payload jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  auto_approved_at timestamptz,
  rejected_at timestamptz,
  approved_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id text references public.menu_items(id),
  item_title text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  action_type text not null,
  actor_phone text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_customer_phone on public.orders(customer_phone);
create index if not exists idx_order_items_order_id on public.order_items(order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.customers enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_actions enable row level security;

drop policy if exists "public can read active categories" on public.menu_categories;
create policy "public can read active categories"
on public.menu_categories
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "public can read active items" on public.menu_items;
create policy "public can read active items"
on public.menu_items
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "public can read active zones" on public.delivery_zones;
create policy "public can read active zones"
on public.delivery_zones
for select
to anon, authenticated
using (is_active = true);
