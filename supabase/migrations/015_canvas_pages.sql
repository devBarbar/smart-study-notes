-- Migration: Add multi-page canvas support with handwritten titles
-- Run this in your Supabase SQL Editor

-- Add canvas_pages JSONB column to sessions table for multi-page support
-- Each page has: id, titleStrokes, strokes, width, height
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS canvas_pages JSONB;

-- Add page_id to answer_links to track which page the answer was drawn on
ALTER TABLE answer_links
ADD COLUMN IF NOT EXISTS page_id TEXT;

-- Create index for faster lookups by page_id
CREATE INDEX IF NOT EXISTS idx_answer_links_page_id
ON answer_links(page_id);

-- Backfill existing canvas_data into canvas_pages as a single page
-- This ensures backward compatibility with existing sessions
UPDATE sessions
SET canvas_pages = jsonb_build_array(
  jsonb_build_object(
    'id', 'page-1',
    'titleStrokes', '[]'::jsonb,
    'strokes', canvas_data,
    'width', 1400,
    'height', 1200
  )
)
WHERE canvas_data IS NOT NULL 
  AND canvas_pages IS NULL
  AND jsonb_array_length(canvas_data) > 0;

-- Update existing answer_links to reference page-1 for backward compatibility
UPDATE answer_links
SET page_id = 'page-1'
WHERE page_id IS NULL
  AND canvas_bounds IS NOT NULL;

