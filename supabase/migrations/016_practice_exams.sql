-- Migration: Practice exams schema and jobs type extension
-- Creates practice exam tables and allows the new job type

-- =====================================================================
-- Extend jobs.type to include practice_exam
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_type_check'
  ) THEN
    ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
  END IF;
END $$;

ALTER TABLE jobs
ADD CONSTRAINT jobs_type_check
CHECK (type IN ('plan','chat','grade','transcribe','metadata','embed','practice_exam'));

-- =====================================================================
-- Practice exams table
-- =====================================================================
CREATE TABLE IF NOT EXISTS practice_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  question_count INTEGER NOT NULL DEFAULT 0,
  score NUMERIC,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Limit status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_exams_status_check'
  ) THEN
    ALTER TABLE practice_exams
    ADD CONSTRAINT practice_exams_status_check
    CHECK (status IN ('pending','ready','in_progress','completed','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_practice_exams_user ON practice_exams(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_exams_lecture ON practice_exams(lecture_id, created_at DESC);

ALTER TABLE practice_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_exams_select_own" ON practice_exams;
CREATE POLICY "practice_exams_select_own" ON practice_exams
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exams_insert_own" ON practice_exams;
CREATE POLICY "practice_exams_insert_own" ON practice_exams
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exams_update_own" ON practice_exams;
CREATE POLICY "practice_exams_update_own" ON practice_exams
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exams_delete_own" ON practice_exams;
CREATE POLICY "practice_exams_delete_own" ON practice_exams
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================================
-- Practice exam questions
-- =====================================================================
CREATE TABLE IF NOT EXISTS practice_exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_exam_id UUID NOT NULL REFERENCES practice_exams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  answer_key TEXT,
  source_file_id UUID REFERENCES lecture_files(id) ON DELETE SET NULL,
  source_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_exam_questions_source_type_check'
  ) THEN
    ALTER TABLE practice_exam_questions
    ADD CONSTRAINT practice_exam_questions_source_type_check
    CHECK (source_type IS NULL OR source_type IN ('exam','worksheet','material'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_practice_exam_questions_exam ON practice_exam_questions(practice_exam_id, order_index);
CREATE INDEX IF NOT EXISTS idx_practice_exam_questions_user ON practice_exam_questions(user_id);

ALTER TABLE practice_exam_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_exam_questions_select_own" ON practice_exam_questions;
CREATE POLICY "practice_exam_questions_select_own" ON practice_exam_questions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_questions_insert_own" ON practice_exam_questions;
CREATE POLICY "practice_exam_questions_insert_own" ON practice_exam_questions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_questions_update_own" ON practice_exam_questions;
CREATE POLICY "practice_exam_questions_update_own" ON practice_exam_questions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_questions_delete_own" ON practice_exam_questions;
CREATE POLICY "practice_exam_questions_delete_own" ON practice_exam_questions
  FOR DELETE USING (auth.uid() = user_id);

-- =====================================================================
-- Practice exam responses
-- =====================================================================
CREATE TABLE IF NOT EXISTS practice_exam_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_exam_id UUID NOT NULL REFERENCES practice_exams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES practice_exam_questions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_answer TEXT,
  feedback JSONB,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_exam_responses_unique_question
  ON practice_exam_responses(question_id);

CREATE INDEX IF NOT EXISTS idx_practice_exam_responses_exam
  ON practice_exam_responses(practice_exam_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_exam_responses_user
  ON practice_exam_responses(user_id);

ALTER TABLE practice_exam_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_exam_responses_select_own" ON practice_exam_responses;
CREATE POLICY "practice_exam_responses_select_own" ON practice_exam_responses
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_responses_insert_own" ON practice_exam_responses;
CREATE POLICY "practice_exam_responses_insert_own" ON practice_exam_responses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_responses_update_own" ON practice_exam_responses;
CREATE POLICY "practice_exam_responses_update_own" ON practice_exam_responses
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "practice_exam_responses_delete_own" ON practice_exam_responses;
CREATE POLICY "practice_exam_responses_delete_own" ON practice_exam_responses
  FOR DELETE USING (auth.uid() = user_id);


