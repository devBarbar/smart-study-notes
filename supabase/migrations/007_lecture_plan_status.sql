-- Migration: Track study plan generation status and errors

-- Add plan status, generated timestamp, and last error to lectures
ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS plan_status TEXT DEFAULT 'ready';

ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS plan_generated_at TIMESTAMPTZ;

ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS plan_error TEXT;

-- Constrain plan_status to expected values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'lectures_plan_status_check'
  ) THEN
    ALTER TABLE lectures
    ADD CONSTRAINT lectures_plan_status_check
    CHECK (plan_status IN ('pending', 'ready', 'failed'));
  END IF;
END $$;

-- Default existing rows to ready with a generated timestamp
UPDATE lectures
SET 
  plan_status = 'ready',
  plan_generated_at = COALESCE(plan_generated_at, NOW())
WHERE plan_status IS NULL;



