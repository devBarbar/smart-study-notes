-- Migration: Add study plan support
-- Run this in your Supabase SQL Editor

-- Add extracted_text column to lecture_files table
ALTER TABLE lecture_files 
ADD COLUMN IF NOT EXISTS extracted_text TEXT;

-- Create study_plan_entries table
CREATE TABLE IF NOT EXISTS study_plan_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  key_concepts TEXT[] DEFAULT '{}',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_study_plan_entries_lecture_id 
ON study_plan_entries(lecture_id);

-- Enable RLS (Row Level Security) - adjust policies as needed
ALTER TABLE study_plan_entries ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (adjust based on your auth setup)
CREATE POLICY "Allow all operations on study_plan_entries" 
ON study_plan_entries 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Add study_plan_entry_id to sessions table for focused study
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS study_plan_entry_id UUID REFERENCES study_plan_entries(id) ON DELETE SET NULL;

