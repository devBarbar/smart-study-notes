-- Helper to hard-delete a lecture and all dependent records for the current user
drop function if exists public.delete_lecture_cascade(uuid);

create or replace function public.delete_lecture_cascade(p_lecture_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Ensure the lecture exists and belongs to the current user
  if not exists (
    select 1
    from lectures
    where id = p_lecture_id
      and user_id = uid
  ) then
    raise exception 'Lecture not found or not owned by user';
  end if;

  -- Session-scoped data
  delete from session_messages sm
  using sessions s
  where sm.session_id = s.id
    and s.lecture_id = p_lecture_id;

  delete from answer_links al
  using sessions s
  where al.session_id = s.id
    and s.lecture_id = p_lecture_id;

  -- Practice exams
  delete from practice_exam_responses per
  using practice_exams pe
  where per.practice_exam_id = pe.id
    and pe.lecture_id = p_lecture_id;

  delete from practice_exam_questions peq
  using practice_exams pe
  where peq.practice_exam_id = pe.id
    and pe.lecture_id = p_lecture_id;

  delete from practice_exams
  where lecture_id = p_lecture_id;

  -- Study plan + embeddings + usage logs
  delete from lecture_file_chunks
  where lecture_id = p_lecture_id;

  delete from ai_usage_logs
  where lecture_id = p_lecture_id;

  delete from study_plan_entries
  where lecture_id = p_lecture_id;

  -- Sessions and files
  delete from sessions
  where lecture_id = p_lecture_id;

  delete from lecture_files
  where lecture_id = p_lecture_id;

  -- Finally remove the lecture
  delete from lectures
  where id = p_lecture_id;
end;
$$;


