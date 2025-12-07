-- Migration: Add canvas bounds to answer links for precise canvas highlighting
-- Run this in your Supabase SQL Editor

ALTER TABLE answer_links
ADD COLUMN IF NOT EXISTS canvas_bounds JSONB;

-- Optional: index for queries filtering by bounds presence
CREATE INDEX IF NOT EXISTS idx_answer_links_canvas_bounds
ON answer_links((canvas_bounds IS NOT NULL));

