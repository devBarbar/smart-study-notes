-- Migration: Add user authentication and data isolation
-- Run this in your Supabase SQL Editor
-- This migration adds user_id to all tables and updates RLS policies

-- ============================================================================
-- Add user_id columns to all tables
-- ============================================================================

-- Add user_id to lectures table
ALTER TABLE lectures 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to lecture_files table
ALTER TABLE lecture_files 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to materials table
ALTER TABLE materials 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to sessions table
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to study_plan_entries table
ALTER TABLE study_plan_entries 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to session_messages table
ALTER TABLE session_messages 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to answer_links table
ALTER TABLE answer_links 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================================
-- Create indexes for user_id columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_lectures_user_id ON lectures(user_id);
CREATE INDEX IF NOT EXISTS idx_lecture_files_user_id ON lecture_files(user_id);
CREATE INDEX IF NOT EXISTS idx_materials_user_id ON materials(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_entries_user_id ON study_plan_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_user_id ON session_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_answer_links_user_id ON answer_links(user_id);

-- ============================================================================
-- Enable RLS on all tables (if not already enabled)
-- ============================================================================

ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_links ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Drop existing permissive policies
-- ============================================================================

DROP POLICY IF EXISTS "Allow all operations on study_plan_entries" ON study_plan_entries;
DROP POLICY IF EXISTS "Allow all operations on session_messages" ON session_messages;
DROP POLICY IF EXISTS "Allow all operations on lectures" ON lectures;
DROP POLICY IF EXISTS "Allow all operations on lecture_files" ON lecture_files;
DROP POLICY IF EXISTS "Allow all operations on materials" ON materials;
DROP POLICY IF EXISTS "Allow all operations on sessions" ON sessions;
DROP POLICY IF EXISTS "Allow all operations on answer_links" ON answer_links;

-- ============================================================================
-- Create new user-scoped RLS policies
-- ============================================================================

-- Lectures policies
CREATE POLICY "Users can view their own lectures"
ON lectures FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own lectures"
ON lectures FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lectures"
ON lectures FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lectures"
ON lectures FOR DELETE
USING (auth.uid() = user_id);

-- Lecture files policies
CREATE POLICY "Users can view their own lecture files"
ON lecture_files FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own lecture files"
ON lecture_files FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lecture files"
ON lecture_files FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lecture files"
ON lecture_files FOR DELETE
USING (auth.uid() = user_id);

-- Materials policies
CREATE POLICY "Users can view their own materials"
ON materials FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own materials"
ON materials FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own materials"
ON materials FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own materials"
ON materials FOR DELETE
USING (auth.uid() = user_id);

-- Sessions policies
CREATE POLICY "Users can view their own sessions"
ON sessions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
ON sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
ON sessions FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
ON sessions FOR DELETE
USING (auth.uid() = user_id);

-- Study plan entries policies
CREATE POLICY "Users can view their own study plan entries"
ON study_plan_entries FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own study plan entries"
ON study_plan_entries FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own study plan entries"
ON study_plan_entries FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study plan entries"
ON study_plan_entries FOR DELETE
USING (auth.uid() = user_id);

-- Session messages policies
CREATE POLICY "Users can view their own session messages"
ON session_messages FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own session messages"
ON session_messages FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own session messages"
ON session_messages FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own session messages"
ON session_messages FOR DELETE
USING (auth.uid() = user_id);

-- Answer links policies
CREATE POLICY "Users can view their own answer links"
ON answer_links FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own answer links"
ON answer_links FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own answer links"
ON answer_links FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own answer links"
ON answer_links FOR DELETE
USING (auth.uid() = user_id);

-- ============================================================================
-- Create function to auto-set user_id on insert (optional, can use app-side instead)
-- ============================================================================

CREATE OR REPLACE FUNCTION set_user_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for auto-setting user_id
DROP TRIGGER IF EXISTS set_lectures_user_id ON lectures;
CREATE TRIGGER set_lectures_user_id
  BEFORE INSERT ON lectures
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_lecture_files_user_id ON lecture_files;
CREATE TRIGGER set_lecture_files_user_id
  BEFORE INSERT ON lecture_files
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_materials_user_id ON materials;
CREATE TRIGGER set_materials_user_id
  BEFORE INSERT ON materials
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_sessions_user_id ON sessions;
CREATE TRIGGER set_sessions_user_id
  BEFORE INSERT ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_study_plan_entries_user_id ON study_plan_entries;
CREATE TRIGGER set_study_plan_entries_user_id
  BEFORE INSERT ON study_plan_entries
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_session_messages_user_id ON session_messages;
CREATE TRIGGER set_session_messages_user_id
  BEFORE INSERT ON session_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

DROP TRIGGER IF EXISTS set_answer_links_user_id ON answer_links;
CREATE TRIGGER set_answer_links_user_id
  BEFORE INSERT ON answer_links
  FOR EACH ROW
  EXECUTE FUNCTION set_user_id();

