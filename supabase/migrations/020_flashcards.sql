-- Migration: Flashcards system for spaced repetition review
-- Stores questions that users passed during AI tutoring sessions

-- ================================
-- Flashcards table
-- ================================
CREATE TABLE IF NOT EXISTS flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lecture_id UUID REFERENCES lectures(id) ON DELETE CASCADE,
  session_id UUID REFERENCES study_sessions(id) ON DELETE SET NULL,
  study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT,
  answer_image_uri TEXT,
  ai_explanation TEXT,
  visual_blocks JSONB,
  mastery_score INTEGER DEFAULT 0,
  next_review_at TIMESTAMPTZ DEFAULT NOW(),
  review_count INTEGER DEFAULT 0,
  ease_factor NUMERIC DEFAULT 2.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================
-- Constraints
-- ================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flashcards_mastery_score_check'
  ) THEN
    ALTER TABLE flashcards
    ADD CONSTRAINT flashcards_mastery_score_check
    CHECK (mastery_score IS NULL OR (mastery_score >= 0 AND mastery_score <= 100));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flashcards_review_count_check'
  ) THEN
    ALTER TABLE flashcards
    ADD CONSTRAINT flashcards_review_count_check
    CHECK (review_count IS NULL OR review_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flashcards_ease_factor_check'
  ) THEN
    ALTER TABLE flashcards
    ADD CONSTRAINT flashcards_ease_factor_check
    CHECK (ease_factor IS NULL OR ease_factor >= 1.3);
  END IF;
END $$;

-- ================================
-- Indexes
-- ================================
CREATE INDEX IF NOT EXISTS idx_flashcards_lecture ON flashcards(lecture_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_flashcards_entry ON flashcards(study_plan_entry_id);

-- ================================
-- Row Level Security
-- ================================
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flashcards_select_own" ON flashcards;
CREATE POLICY "flashcards_select_own" ON flashcards
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "flashcards_insert_own" ON flashcards;
CREATE POLICY "flashcards_insert_own" ON flashcards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "flashcards_update_own" ON flashcards;
CREATE POLICY "flashcards_update_own" ON flashcards
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "flashcards_delete_own" ON flashcards;
CREATE POLICY "flashcards_delete_own" ON flashcards
  FOR DELETE USING (auth.uid() = user_id);
