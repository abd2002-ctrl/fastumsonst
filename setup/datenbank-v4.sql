-- FastUmsonst: Video-Link für Rezepte der Woche
-- Einmal im Supabase SQL Editor ausführen.
alter table public.recipes add column if not exists video_url text
  check (video_url is null or video_url ~ '^https://');
