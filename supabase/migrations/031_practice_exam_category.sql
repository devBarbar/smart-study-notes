alter table public.practice_exams
  add column if not exists category text;

create index if not exists practice_exams_lecture_category_idx
  on public.practice_exams (lecture_id, category)
  where category is not null;

notify pgrst, 'reload schema';
