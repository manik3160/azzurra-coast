-- Azzurra Coast leaderboard schema.
-- Run this once in the Supabase SQL editor for your project.

create table if not exists public.lap_times (
  id          bigint generated always as identity primary key,
  player_name text        not null check (char_length(player_name) between 1 and 24),
  lap_ms      integer     not null check (lap_ms between 20000 and 900000), -- 20s..15min sanity floor
  track       text        not null default 'azzurra-coast',
  laps        smallint    not null default 3 check (laps between 1 and 10),
  ai_count    smallint    not null default 0 check (ai_count between 0 and 9),
  assists     text        not null default 'TC/ABS',
  created_at  timestamptz not null default now()
);

create index if not exists lap_times_track_lapms_idx on public.lap_times (track, lap_ms);

alter table public.lap_times enable row level security;

-- Anyone (anon key) can read the board.
create policy "lap_times_select_anon" on public.lap_times
  for select
  to anon
  using (true);

-- Anyone can submit a time, but never update or delete one — the table is
-- append-only from the client, which is the cheapest anti-tamper guard
-- available without server-side validation.
create policy "lap_times_insert_anon" on public.lap_times
  for insert
  to anon
  with check (true);

-- No update/delete policy is defined for `anon`, so both are denied by RLS.
