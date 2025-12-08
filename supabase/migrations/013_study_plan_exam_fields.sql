-- Migration: Add exam tracking fields to study_plan_entries
-- These fields track whether a topic came from exam content and if it was mentioned in instructor notes

-- Add from_exam_source column (true if topic was extracted from a file marked as exam)
ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS from_exam_source BOOLEAN DEFAULT FALSE;

-- Add exam_relevance column (high, medium, low - indicates likelihood of appearing on exam)
ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS exam_relevance TEXT;

-- Add mentioned_in_notes column (true if topic was mentioned in instructor/additional notes)
ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS mentioned_in_notes BOOLEAN DEFAULT FALSE;

-- Add constraint for exam_relevance values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_plan_entries_exam_relevance_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_exam_relevance_check
    CHECK (exam_relevance IS NULL OR exam_relevance IN ('high', 'medium', 'low'));
  END IF;
END $$;

-- Create index for quick filtering by exam relevance
CREATE INDEX IF NOT EXISTS idx_study_plan_entries_exam_relevance 
ON study_plan_entries(lecture_id, from_exam_source, exam_relevance)
WHERE from_exam_source = TRUE OR exam_relevance = 'high';

