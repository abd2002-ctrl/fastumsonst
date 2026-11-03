-- FastUmsonst: Datenbank-Einrichtung (Phase 2)
-- Einmal komplett im Supabase SQL Editor ausführen.

-- 1) Tabellen ---------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null default 'beta',            -- beta | free | premium
  premium_until timestamptz,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users on delete cascade,
  tank_l numeric not null default 50 check (tank_l between 10 and 200),
  cons numeric not null default 6.5 check (cons between 2 and 30),
  week_km numeric not null default 250 check (week_km between 0 and 5000),
  fuel text not null default 'e10' check (fuel in ('e5','e10','diesel')),
  tank_liters numeric check (tank_liters between 0 and 200),
  tank_at timestamptz,
  home_lat numeric check (home_lat between 47 and 56),
  home_lng numeric check (home_lng between 5 and 16),
  tank_alarm boolean not null default false,
  tank_notified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  fuel text not null check (fuel in ('e5','e10','diesel')),
  max_price numeric not null check (max_price between 0.5 and 5),
  lat numeric not null check (lat between 47 and 56),
  lng numeric not null check (lng between 5 and 16),
  radius numeric not null default 5 check (radius between 1 and 25),
  active boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists price_alerts_user_idx on public.price_alerts (user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 2) Sicherheit: jeder sieht nur seine eigenen Daten -------------------------

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.price_alerts enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "eigenes Profil lesen" on public.profiles;
create policy "eigenes Profil lesen" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "eigene Einstellungen" on public.settings;
create policy "eigene Einstellungen" on public.settings
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "eigene Preisalarme" on public.price_alerts;
create policy "eigene Preisalarme" on public.price_alerts
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "eigene Push-Abos" on public.push_subscriptions;
create policy "eigene Push-Abos" on public.push_subscriptions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.settings, public.price_alerts, public.push_subscriptions to authenticated;
grant all on public.profiles, public.settings, public.price_alerts, public.push_subscriptions to service_role;

-- Höchstens 5 Preisalarme pro Nutzer
create or replace function public.limit_price_alerts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.price_alerts where user_id = new.user_id) >= 5 then
    raise exception 'Maximal 5 Preisalarme';
  end if;
  return new;
end $$;
drop trigger if exists price_alerts_limit on public.price_alerts;
create trigger price_alerts_limit before insert on public.price_alerts
  for each row execute function public.limit_price_alerts();

-- Profil automatisch anlegen, wenn sich jemand anmeldet
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nutzer kann sich selbst samt allen Daten löschen
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- 3) Automatische Prüfung alle 30 Minuten ------------------------------------

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule('fastumsonst-check') where exists (select 1 from cron.job where jobname = 'fastumsonst-check');
select cron.schedule(
  'fastumsonst-check',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fastumsonst.vercel.app/api/check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer __CRON_SECRET__'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
