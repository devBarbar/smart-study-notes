-- Add partial_result column for streaming job updates
alter table public.jobs add column if not exists partial_result text;

-- Index for faster lookups during streaming updates
create index if not exists idx_jobs_partial_result_update on public.jobs (id) where partial_result is not null;

