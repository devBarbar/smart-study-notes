CREATE OR REPLACE FUNCTION public.reset_lecture_progress(p_lecture_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session_count INTEGER := 0;
  v_flashcard_count INTEGER := 0;
  v_practice_exam_count INTEGER := 0;
  v_cheat_sheet_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated to reset lecture progress';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.lectures
    WHERE id = p_lecture_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Lecture not found';
  END IF;

  SELECT COUNT(*) INTO v_session_count
  FROM public.sessions
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  SELECT COUNT(*) INTO v_flashcard_count
  FROM public.flashcards
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  SELECT COUNT(*) INTO v_practice_exam_count
  FROM public.practice_exams
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  SELECT COUNT(*) INTO v_cheat_sheet_count
  FROM public.lecture_cheat_sheets
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.practice_exam_responses
  WHERE user_id = v_user_id
    AND practice_exam_id IN (
      SELECT id
      FROM public.practice_exams
      WHERE lecture_id = p_lecture_id
        AND user_id = v_user_id
    );

  DELETE FROM public.practice_exam_questions
  WHERE practice_exam_id IN (
    SELECT id
    FROM public.practice_exams
    WHERE lecture_id = p_lecture_id
      AND user_id = v_user_id
  );

  DELETE FROM public.practice_exams
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.flashcards
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.answer_links
  WHERE user_id = v_user_id
    AND session_id IN (
      SELECT id
      FROM public.sessions
      WHERE lecture_id = p_lecture_id
        AND user_id = v_user_id
    );

  DELETE FROM public.session_messages
  WHERE user_id = v_user_id
    AND session_id IN (
      SELECT id
      FROM public.sessions
      WHERE lecture_id = p_lecture_id
        AND user_id = v_user_id
    );

  DELETE FROM public.study_depth_checks
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.tutor_answer_evaluations
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.study_misconceptions
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.review_history
  WHERE user_id = v_user_id
    AND study_plan_entry_id IN (
      SELECT id
      FROM public.study_plan_entries
      WHERE lecture_id = p_lecture_id
        AND user_id = v_user_id
    );

  DELETE FROM public.sessions
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  DELETE FROM public.lecture_cheat_sheets
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  UPDATE public.study_plan_entries
  SET
    status = 'not_started',
    status_score = NULL,
    status_updated_at = NULL,
    mastery_score = NULL,
    next_review_at = NULL,
    review_count = NULL,
    ease_factor = NULL
  WHERE lecture_id = p_lecture_id
    AND user_id = v_user_id;

  UPDATE public.lectures
  SET
    roadmap = NULL,
    readiness = NULL
  WHERE id = p_lecture_id
    AND user_id = v_user_id;

  UPDATE public.jobs
  SET
    status = 'failed',
    error = 'Lecture progress was reset before this job completed.'
  WHERE user_id = v_user_id
    AND status IN ('pending', 'running')
    AND payload->>'lectureId' = p_lecture_id::TEXT;

  RETURN jsonb_build_object(
    'sessions', v_session_count,
    'flashcards', v_flashcard_count,
    'practiceExams', v_practice_exam_count,
    'cheatSheets', v_cheat_sheet_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_lecture_progress(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
