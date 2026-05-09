alter table public.jobs drop constraint if exists jobs_type_check;

alter table public.jobs
  add constraint jobs_type_check
  check (
    type = any (
      array[
        'plan'::text,
        'chat'::text,
        'grade'::text,
        'transcribe'::text,
        'metadata'::text,
        'embed'::text,
        'practice_exam'::text,
        'lecture_plan_v2'::text,
        'lecture_plan_inventory'::text,
        'lecture_plan_synthesize'::text
      ]
    )
  );
