-- Migration: Track per-section mastery status

-- Add status fields to study_plan_entries
ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'in_progress';

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS status_score INTEGER;

ALTER TABLE study_plan_entries
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Constrain status to expected values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_plan_entries_status_check'
  ) THEN
    ALTER TABLE study_plan_entries
    ADD CONSTRAINT study_plan_entries_status_check
    CHECK (status IN ('in_progress', 'passed', 'failed'));
  END IF;
END $$;

-- Default existing rows
UPDATE study_plan_entries
SET status = COALESCE(status, 'in_progress'),
    status_updated_at = COALESCE(status_updated_at, NOW())
WHERE status IS NULL OR status_updated_at IS NULL;



