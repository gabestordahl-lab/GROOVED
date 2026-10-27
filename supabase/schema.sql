-- GROOVED v1 database
-- Run this in Supabase SQL Editor before using cloud accounts.

create extension if not exists pgcrypto;

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('song','album','artist')),
  mbid uuid not null,
  title text not null,
  artist text not null,
  subtitle text,
  release_group_mbid uuid,
  cover_url text,
  overall numeric(3,1) not null check (overall between 0 and 10),
  lyrics numeric(3,1) not null check (lyrics between 0 and 10),
  production numeric(3,1) not null check (production between 0 and 10),
  melody numeric(3,1) not null check (melody between 0 and 10),
  vocals numeric(3,1) not null check (vocals between 0 and 10),
  emotion numeric(3,1) not null check (emotion between 0 and 10),
  tiebreak integer not null default 50 check (tiebreak between 0 and 100),
  review text not null default '' check (char_length(review) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity_type, mbid)
);

alter table public.ratings enable row level security;

revoke all on table public.ratings from anon;
revoke all on table public.ratings from authenticated;
grant select, insert, update, delete on table public.ratings to authenticated;

create policy "ratings_select_own"
on public.ratings for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "ratings_insert_own"
on public.ratings for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "ratings_update_own"
on public.ratings for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "ratings_delete_own"
on public.ratings for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists ratings_user_updated_idx on public.ratings (user_id, updated_at desc);
create index if not exists ratings_user_score_idx on public.ratings (user_id, overall desc);
