-- Learning path study plan redesign

ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS plan_settings JSONB;

CREATE TABLE IF NOT EXISTS study_plan_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_plan_modules_lecture_order
ON study_plan_modules(lecture_id, order_index);

ALTER TABLE study_plan_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "study_plan_modules_select_own" ON study_plan_modules;
CREATE POLICY "study_plan_modules_select_own"
ON study_plan_modules FOR SELECT
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "study_plan_modules_insert_own" ON study_plan_modules;
CREATE POLICY "study_plan_modules_insert_own"
ON study_plan_modules FOR INSERT
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "study_plan_modules_update_own" ON study_plan_modules;
CREATE POLICY "study_plan_modules_update_own"
ON study_plan_modules FOR UPDATE
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
)
WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

DROP POLICY IF EXISTS "study_plan_modules_delete_own" ON study_plan_modules;
CREATE POLICY "study_plan_modules_delete_own"
ON study_plan_modules FOR DELETE
USING (
  auth.role() = 'service_role'
  OR auth.uid() IS NOT NULL AND auth.uid() = user_id
);

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS module_id UUID REFERENCES study_plan_modules(id) ON DELETE SET NULL;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS prerequisite_entry_ids UUID[] DEFAULT '{}';

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS learning_objective TEXT;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS difficulty TEXT;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS sequence_reason TEXT;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS source_refs JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_plan_entries_difficulty_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('intro', 'core', 'advanced'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_study_plan_entries_module_order
ON study_plan_entries(module_id, order_index);

CREATE INDEX IF NOT EXISTS idx_study_plan_entries_prerequisites
ON study_plan_entries USING GIN(prerequisite_entry_ids);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.study_plan_modules;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
ADD CONSTRAINT jobs_type_check
CHECK (type IN ('plan','chat','grade','transcribe','metadata','embed','practice_exam','lecture_plan_v2'));
