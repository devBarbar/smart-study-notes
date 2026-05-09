-- Structured tutor metadata and misconception tracking

ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS tutor_question JSONB;

ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS visual_block_ids JSONB;

CREATE INDEX IF NOT EXISTS idx_session_messages_tutor_question
ON session_messages
USING GIN (tutor_question);

CREATE TABLE IF NOT EXISTS study_misconceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
  study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  concept TEXT NOT NULL,
  note TEXT NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_misconceptions_lookup
ON study_misconceptions(user_id, lecture_id, study_plan_entry_id, resolved, created_at DESC);

ALTER TABLE study_misconceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study misconceptions" ON study_misconceptions;
CREATE POLICY "Users can view own study misconceptions"
ON study_misconceptions FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own study misconceptions" ON study_misconceptions;
CREATE POLICY "Users can insert own study misconceptions"
ON study_misconceptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own study misconceptions" ON study_misconceptions;
CREATE POLICY "Users can update own study misconceptions"
ON study_misconceptions FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
