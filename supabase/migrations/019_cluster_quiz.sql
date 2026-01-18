-- Add category column to practice_exams for cluster-scoped quizzes
-- When category is set, this practice exam is a "Cluster Quiz" for that specific topic cluster

ALTER TABLE practice_exams
ADD COLUMN IF NOT EXISTS category TEXT;

-- Index for faster lookup by category
CREATE INDEX IF NOT EXISTS idx_practice_exams_category 
ON practice_exams(lecture_id, category) 
WHERE category IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN practice_exams.category IS 'When set, indicates this is a cluster quiz scoped to a specific topic category';
