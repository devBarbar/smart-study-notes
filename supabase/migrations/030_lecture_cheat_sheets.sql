-- Lecture-level AI cheat sheets and tutor answer evaluation evidence

CREATE TABLE IF NOT EXISTS lecture_cheat_sheets (
  lecture_id UUID PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'pending', 'ready', 'failed')),
  content JSONB,
  error TEXT,
  last_generated_at TIMESTAMPTZ,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lecture_cheat_sheets_user
ON lecture_cheat_sheets(user_id, updated_at DESC);

ALTER TABLE lecture_cheat_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lecture_cheat_sheets_select_own" ON lecture_cheat_sheets;
CREATE POLICY "lecture_cheat_sheets_select_own"
ON lecture_cheat_sheets FOR SELECT
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "lecture_cheat_sheets_insert_own" ON lecture_cheat_sheets;
CREATE POLICY "lecture_cheat_sheets_insert_own"
ON lecture_cheat_sheets FOR INSERT
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "lecture_cheat_sheets_update_own" ON lecture_cheat_sheets;
CREATE POLICY "lecture_cheat_sheets_update_own"
ON lecture_cheat_sheets FOR UPDATE
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
)
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

CREATE TABLE IF NOT EXISTS tutor_answer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  question_id TEXT,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  correctness TEXT,
  check_type TEXT CHECK (check_type IS NULL OR check_type IN ('recall', 'why', 'apply', 'transfer', 'teach_back')),
  feedback JSONB,
  misconceptions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tutor_answer_evaluations_lecture
ON tutor_answer_evaluations(user_id, lecture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tutor_answer_evaluations_gap_signals
ON tutor_answer_evaluations(lecture_id, score, correctness);

ALTER TABLE tutor_answer_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tutor_answer_evaluations_select_own" ON tutor_answer_evaluations;
CREATE POLICY "tutor_answer_evaluations_select_own"
ON tutor_answer_evaluations FOR SELECT
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "tutor_answer_evaluations_insert_own" ON tutor_answer_evaluations;
CREATE POLICY "tutor_answer_evaluations_insert_own"
ON tutor_answer_evaluations FOR INSERT
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
ADD CONSTRAINT jobs_type_check
CHECK (type IN (
  'plan',
  'chat',
  'grade',
  'transcribe',
  'metadata',
  'embed',
  'practice_exam',
  'lecture_plan_v2',
  'lecture_plan_inventory',
  'lecture_plan_synthesize',
  'question_generation',
  'readiness_roadmap',
  'cheat_sheet'
));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lecture_cheat_sheets;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

