-- Migration: Add explicit not_started status for study plan entries

-- Use "not_started" as the default for new study plan entries
ALTER TABLE study_plan_entries
ALTER COLUMN status SET DEFAULT 'not_started';

-- Recreate the status constraint to include not_started
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_plan_entries_status_check'
  ) THEN
    ALTER TABLE study_plan_entries DROP CONSTRAINT study_plan_entries_status_check;
  END IF;
END $$;

ALTER TABLE study_plan_entries
ADD CONSTRAINT study_plan_entries_status_check
CHECK (status IN ('not_started', 'in_progress', 'passed', 'failed'));

-- Backfill: mark entries with no sessions as not_started
UPDATE study_plan_entries spe
SET status = 'not_started',
    status_updated_at = COALESCE(status_updated_at, NOW())
WHERE (status IS NULL OR status = 'in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.study_plan_entry_id = spe.id
  );



