-- FastUmsonst Datenbank v5: Lieblingsprodukte und Konto-Sicherung
-- Einmal im Supabase SQL Editor ausführen (Run). Kann gefahrlos mehrfach laufen.

-- 1) Lieblingsprodukte (für den Montags-Alarm)
create table if not exists public.favorites (
  user_id uuid not null references auth.users on delete cascade,
  word text not null check (char_length(word) between 2 and 40),
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);
alter table public.favorites enable row level security;
drop policy if exists "eigene Lieblingsprodukte" on public.favorites;
create policy "eigene Lieblingsprodukte" on public.favorites
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, delete on public.favorites to authenticated;
grant all on public.favorites to service_role;

-- Höchstens 30 Lieblingsprodukte pro Nutzer
create or replace function public.limit_favorites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.favorites where user_id = new.user_id) >= 30 then
    raise exception 'Maximal 30 Lieblingsprodukte';
  end if;
  return new;
end $$;
drop trigger if exists favorites_limit on public.favorites;
create trigger favorites_limit before insert on public.favorites
  for each row execute function public.limit_favorites();

-- 2) Gesicherte App-Daten (nur für Nutzer mit E-Mail-Konto)
create table if not exists public.user_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
drop policy if exists "eigene Daten" on public.user_data;
create policy "eigene Daten" on public.user_data
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_data to authenticated;
grant all on public.user_data to service_role;
