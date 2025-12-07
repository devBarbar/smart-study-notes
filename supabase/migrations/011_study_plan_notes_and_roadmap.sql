-- Migration: Additional notes and AI roadmap/readiness storage
-- Run in Supabase SQL Editor

-- Add instructor/additional notes to lectures
ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS additional_notes TEXT;

-- Persist AI roadmap steps as JSONB
ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS roadmap JSONB;

-- Persist AI readiness probabilities/summary as JSONB
ALTER TABLE lectures
ADD COLUMN IF NOT EXISTS readiness JSONB;

