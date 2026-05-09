-- Disable the old polling worker that invoked process-job every 30 seconds.
-- enqueue-job now triggers process-job once when a new job is created.
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'enqueue'
      and command ilike '%/functions/v1/process-job%'
  ) then
    perform cron.unschedule('enqueue');
  end if;
end $$;
