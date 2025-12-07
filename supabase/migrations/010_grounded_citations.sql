-- Grounded citations + embeddings for tutoring

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Store per-file/page embeddings for lecture materials
CREATE TABLE IF NOT EXISTS lecture_file_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  lecture_file_id UUID NOT NULL REFERENCES lecture_files(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL DEFAULT 1,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  content_hash TEXT,
  embedding vector(1536) NOT NULL,
  source_bbox JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lecture_file_chunks_lecture
  ON lecture_file_chunks(lecture_id);

CREATE INDEX IF NOT EXISTS idx_lecture_file_chunks_file
  ON lecture_file_chunks(lecture_file_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lecture_file_chunks_hash
  ON lecture_file_chunks(content_hash);

-- Vector index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_lecture_file_chunks_embedding
  ON lecture_file_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE lecture_file_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on lecture_file_chunks"
ON lecture_file_chunks
FOR ALL
USING (true)
WITH CHECK (true);

-- Search function for top-K chunks
CREATE OR REPLACE FUNCTION match_lecture_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 6,
  min_similarity FLOAT DEFAULT 0.2,
  lecture_filter UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  lecture_id UUID,
  lecture_file_id UUID,
  page_number INT,
  chunk_index INT,
  content TEXT,
  similarity FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.lecture_id,
    c.lecture_file_id,
    c.page_number,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM lecture_file_chunks c
  WHERE (lecture_filter IS NULL OR c.lecture_id = ANY (lecture_filter))
    AND (1 - (c.embedding <=> query_embedding)) >= min_similarity
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Persist citations on messages
ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS citations JSONB;

CREATE INDEX IF NOT EXISTS idx_session_messages_citations
  ON session_messages
  USING GIN (citations);

