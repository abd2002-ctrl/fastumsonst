-- FastUmsonst: Rezepte der Woche
-- Einmal komplett im Supabase SQL Editor ausführen.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  intro text check (char_length(intro) <= 300),
  servings int not null default 4 check (servings between 1 and 20),
  minutes int check (minutes is null or minutes between 1 and 600),
  total_price numeric check (total_price is null or (total_price >= 0 and total_price < 1000)),
  ingredients jsonb not null default '[]'::jsonb,   -- [{"name":"Schweinegulasch","qty":"1 kg","store":"Aldi Süd","price":4.99}]
  steps jsonb not null default '[]'::jsonb,         -- ["Zwiebeln schneiden …", "…"]
  valid_until date not null,
  is_teaser boolean not null default false,         -- als Vorschau für alle sichtbar
  created_at timestamptz not null default now()
);
create index if not exists recipes_valid_idx on public.recipes (valid_until);

alter table public.recipes enable row level security;

drop policy if exists "Rezepte lesen" on public.recipes;
create policy "Rezepte lesen" on public.recipes
  for select to anon, authenticated
  using (is_teaser or (select public.is_premium()));

grant select on public.recipes to anon, authenticated;
grant all on public.recipes to service_role;
