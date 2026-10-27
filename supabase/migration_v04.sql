-- GROOVED v0.4 migration for existing Supabase projects
-- Run once in Supabase SQL Editor before testing this build.

alter table public.ratings
add column if not exists tiebreak integer not null default 50;

alter table public.ratings
drop constraint if exists ratings_tiebreak_check;

alter table public.ratings
add constraint ratings_tiebreak_check check (tiebreak between 0 and 100);

-- Existing melody values are now displayed as Sound.
-- Existing vocals values are now displayed as Uniqueness.
-- This preserves prior ratings without deleting data.
