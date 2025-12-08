-- Migration: Adaptive mastery & spaced repetition foundation
-- Adds mastery tracking fields, review history, and user streak metadata

-- ================================
-- Study plan entry mastery fields
-- ================================
ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS mastery_score INTEGER;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS ease_factor NUMERIC DEFAULT 2.5;

-- Constrain ranges
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_plan_entries_mastery_score_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_mastery_score_check
    CHECK (mastery_score IS NULL OR (mastery_score >= 0 AND mastery_score <= 100));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_plan_entries_review_count_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_review_count_check
    CHECK (review_count IS NULL OR review_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_plan_entries_ease_factor_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_ease_factor_check
    CHECK (ease_factor IS NULL OR ease_factor >= 1.3);
  END IF;
END $$;

-- Default existing rows
UPDATE study_plan_entries
SET
  review_count = COALESCE(review_count, 0),
  ease_factor = COALESCE(ease_factor, 2.5),
  next_review_at = COALESCE(next_review_at, NOW())
WHERE review_count IS NULL
   OR ease_factor IS NULL
   OR next_review_at IS NULL;

-- ================================
-- Review history table
-- ================================
CREATE TABLE IF NOT EXISTS review_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE CASCADE,
  score INTEGER,
  response_quality TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constrain values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_history_score_check'
  ) THEN
    ALTER TABLE review_history
    ADD CONSTRAINT review_history_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 100));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_history_response_quality_check'
  ) THEN
    ALTER TABLE review_history
    ADD CONSTRAINT review_history_response_quality_check
    CHECK (response_quality IS NULL OR response_quality IN ('correct','incorrect','partial','skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_review_history_entry ON review_history(study_plan_entry_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_history_user ON review_history(user_id, reviewed_at DESC);

ALTER TABLE review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_history_select_own" ON review_history;
CREATE POLICY "review_history_select_own" ON review_history
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "review_history_insert_own" ON review_history;
CREATE POLICY "review_history_insert_own" ON review_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "review_history_update_own" ON review_history;
CREATE POLICY "review_history_update_own" ON review_history
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "review_history_delete_own" ON review_history;
CREATE POLICY "review_history_delete_own" ON review_history
  FOR DELETE USING (auth.uid() = user_id);

-- ================================
-- User streak metadata
-- ================================
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS current_streak INTEGER DEFAULT 0;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS last_review_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_current_streak_check'
  ) THEN
    ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_current_streak_check
    CHECK (current_streak IS NULL OR current_streak >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_longest_streak_check'
  ) THEN
    ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_longest_streak_check
    CHECK (longest_streak IS NULL OR longest_streak >= 0);
  END IF;
END $$;

