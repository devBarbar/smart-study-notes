-- Jobs table for queued AI tasks
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('plan','chat','grade','transcribe','metadata','embed')),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  payload jsonb not null,
  result jsonb,
  error text,
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
before update on public.jobs
for each row
execute function public.set_updated_at();

-- Indexes for scheduling and lookup
create index if not exists idx_jobs_status_created_at on public.jobs (status, created_at);
create index if not exists idx_jobs_user on public.jobs (user_id);

-- RLS
alter table public.jobs enable row level security;

-- Clients can insert/select their own jobs
drop policy if exists "jobs_insert_own" on public.jobs;
create policy "jobs_insert_own" on public.jobs
  for insert
  with check (
    auth.role() = 'service_role'
    or auth.uid() is not null and auth.uid() = user_id
  );

drop policy if exists "jobs_select_own" on public.jobs;
create policy "jobs_select_own" on public.jobs
  for select
  using (
    auth.role() = 'service_role'
    or auth.uid() is not null and auth.uid() = user_id
  );

-- Only service role can update job status/results
drop policy if exists "jobs_update_service" on public.jobs;
create policy "jobs_update_service" on public.jobs
  for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Realtime broadcasts
alter publication supabase_realtime add table public.jobs;

