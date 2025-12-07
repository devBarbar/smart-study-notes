-- Migration: Add session messages table for persisting chat history
-- Run this in your Supabase SQL Editor

-- Create session_messages table
CREATE TABLE IF NOT EXISTS session_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ai', 'user', 'system')),
  text TEXT NOT NULL,
  question_id TEXT,
  answer_link_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups by session_id
CREATE INDEX IF NOT EXISTS idx_session_messages_session_id 
ON session_messages(session_id);

-- Create index for ordering messages
CREATE INDEX IF NOT EXISTS idx_session_messages_created_at 
ON session_messages(session_id, created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (adjust based on your auth setup)
CREATE POLICY "Allow all operations on session_messages" 
ON session_messages 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Add canvas_data column to sessions table for persisting canvas strokes
-- This stores the strokes as JSON for restoring the canvas
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS canvas_data JSONB;

-- Add notes_text column to sessions table for persisting typed notes
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS notes_text TEXT;

