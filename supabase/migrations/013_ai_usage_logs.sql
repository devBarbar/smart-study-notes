-- AI usage logging for per-interaction and per-lecture cost tracking
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  lecture_id uuid references public.lectures(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  feature text not null,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  audio_duration_seconds numeric,
  input_cost_usd numeric(12, 6),
  output_cost_usd numeric(12, 6),
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_logs_user_created_at on public.ai_usage_logs (user_id, created_at desc);
create index if not exists idx_ai_usage_logs_lecture on public.ai_usage_logs (lecture_id);
create index if not exists idx_ai_usage_logs_job on public.ai_usage_logs (job_id);

alter table public.ai_usage_logs enable row level security;

drop policy if exists "ai_usage_logs_select_own" on public.ai_usage_logs;
create policy "ai_usage_logs_select_own"
  on public.ai_usage_logs
  for select
  using (
    auth.role() = 'service_role'
    or auth.uid() is not null and auth.uid() = user_id
  );

drop policy if exists "ai_usage_logs_insert_owned_or_service" on public.ai_usage_logs;
create policy "ai_usage_logs_insert_owned_or_service"
  on public.ai_usage_logs
  for insert
  with check (
    auth.role() = 'service_role'
    or auth.uid() is not null and auth.uid() = user_id
  );

drop policy if exists "ai_usage_logs_update_service" on public.ai_usage_logs;
create policy "ai_usage_logs_update_service"
  on public.ai_usage_logs
  for update
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "ai_usage_logs_delete_service" on public.ai_usage_logs;
create policy "ai_usage_logs_delete_service"
  on public.ai_usage_logs
  for delete
  using (auth.role() = 'service_role');
