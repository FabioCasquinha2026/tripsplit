-- TripSplit: estrutura Supabase
create extension if not exists pgcrypto;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(trip_id, name)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  description text not null,
  amount numeric(14,2) not null,
  currency text not null default 'EUR',
  rate_to_eur numeric(18,8),
  amount_eur numeric(14,2) not null,
  payer_id uuid not null references public.participants(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expense_participants (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key(expense_id, participant_id)
);

alter table public.trips enable row level security;
alter table public.participants enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;

-- Para um protótipo privado/teste, estas políticas permitem acesso público.
-- Antes de transformar o TripSplit em produto, substituir por autenticação.
create policy "trips public read" on public.trips for select using (true);
create policy "trips public insert" on public.trips for insert with check (true);

create policy "participants public all" on public.participants for all using (true) with check (true);
create policy "expenses public all" on public.expenses for all using (true) with check (true);
create policy "expense participants public all" on public.expense_participants for all using (true) with check (true);
