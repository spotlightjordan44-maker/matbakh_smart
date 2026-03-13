
create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  customer_id uuid references public.customers(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound','internal')),
  channel text not null default 'WHATSAPP',
  message_type text not null default 'text',
  intent text,
  text text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_messages_phone_created
on public.conversation_messages(customer_phone, created_at desc);

create table if not exists public.customer_facts (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  customer_id uuid references public.customers(id) on delete set null,
  fact_key text not null,
  fact_value text,
  confidence numeric(5,2) not null default 0.80,
  source text not null default 'bot_memory',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_phone, fact_key)
);

create index if not exists idx_customer_facts_phone on public.customer_facts(customer_phone);

create table if not exists public.bot_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  language text not null default 'ar',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bot_knowledge_entries_active on public.bot_knowledge_entries(is_active);

alter table public.conversation_messages enable row level security;
alter table public.customer_facts enable row level security;
alter table public.bot_knowledge_entries enable row level security;
