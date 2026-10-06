create table if not exists public.scout_reports (
  id text primary key,
  host text not null,
  url text not null,
  title text,
  score int,
  created_at bigint not null,
  report jsonb not null
);
create index if not exists scout_reports_host_idx on public.scout_reports (host, created_at desc);
create index if not exists scout_reports_created_idx on public.scout_reports (created_at desc);
alter table public.scout_reports enable row level security;
-- No policies: only the server (service role key) reads and writes.
