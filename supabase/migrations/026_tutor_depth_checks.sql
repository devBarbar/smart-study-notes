-- Persistent depth checks for multi-step tutor pass gates

CREATE TABLE IF NOT EXISTS study_depth_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
  study_plan_entry_id UUID NOT NULL REFERENCES study_plan_entries(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  question_id TEXT,
  question_text TEXT NOT NULL,
  check_type TEXT NOT NULL CHECK (check_type IN ('recall', 'why', 'apply', 'transfer', 'teach_back')),
  score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  correctness TEXT,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  can_count_for_pass BOOLEAN NOT NULL DEFAULT FALSE,
  feedback_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_depth_checks_entry
ON study_depth_checks(study_plan_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_study_depth_checks_pass_gate
ON study_depth_checks(user_id, study_plan_entry_id, check_type, passed, can_count_for_pass);

ALTER TABLE study_depth_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "study_depth_checks_select_own" ON study_depth_checks;
CREATE POLICY "study_depth_checks_select_own"
ON study_depth_checks FOR SELECT
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "study_depth_checks_insert_own" ON study_depth_checks;
CREATE POLICY "study_depth_checks_insert_own"
ON study_depth_checks FOR INSERT
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "study_depth_checks_update_own" ON study_depth_checks;
CREATE POLICY "study_depth_checks_update_own"
ON study_depth_checks FOR UPDATE
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
)
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);
