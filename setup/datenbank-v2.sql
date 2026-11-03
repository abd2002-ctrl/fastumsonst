-- FastUmsonst: Datenbank-Erweiterung für Premium (Angebote der Woche)
-- Einmal komplett im Supabase SQL Editor ausführen.

-- 1) Profile um Abo-Daten erweitern
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles alter column plan set default 'free';
update public.profiles set plan = 'free' where plan = 'beta';
create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);

-- 2) Angebote der Woche
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  keyword text check (char_length(keyword) <= 40),          -- Zutat für die Rezeptsuche, z. B. "Hackfleisch"
  store text not null check (char_length(store) between 2 and 40),
  price numeric not null check (price > 0 and price < 10000),
  old_price numeric check (old_price is null or (old_price > 0 and old_price < 10000)),
  unit text check (char_length(unit) <= 40),                -- z. B. "500 g" oder "je kg"
  category text check (char_length(category) <= 40),
  region text not null default 'bundesweit' check (char_length(region) <= 40),
  valid_from date,
  valid_until date not null,
  source_url text check (source_url is null or source_url ~ '^https://'),
  recipe_links jsonb not null default '[]'::jsonb,          -- [{"title":"…","url":"https://…"}]
  is_teaser boolean not null default false,                 -- als Vorschau für alle sichtbar
  created_at timestamptz not null default now()
);
create index if not exists offers_valid_idx on public.offers (valid_until);

alter table public.offers enable row level security;

-- Wer darf Angebote sehen? Vorschau-Angebote alle, den Rest nur Premium.
create or replace function public.is_premium() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.plan = 'premium' and p.premium_until > now()
  );
$$;
revoke all on function public.is_premium() from public;
grant execute on function public.is_premium() to anon, authenticated;

drop policy if exists "Angebote lesen" on public.offers;
create policy "Angebote lesen" on public.offers
  for select to anon, authenticated
  using (is_teaser or (select public.is_premium()));

grant select on public.offers to anon, authenticated;
grant all on public.offers to service_role;
