-- Migration: Study plan categories, tiers, and exam flags
-- Run this in your Supabase SQL Editor

-- Flag lecture files that are past exams
ALTER TABLE lecture_files 
ADD COLUMN IF NOT EXISTS is_exam BOOLEAN DEFAULT FALSE;

-- Categorize and prioritize study plan entries
ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS importance_tier TEXT DEFAULT 'core';

ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 0;

-- Helpful index for sorting by priority within a lecture
CREATE INDEX IF NOT EXISTS idx_study_plan_entries_priority 
ON study_plan_entries(lecture_id, importance_tier, priority_score DESC, order_index);

