-- Add page/line metadata used by in-app PDF reference navigation.

ALTER TABLE lecture_files
ADD COLUMN IF NOT EXISTS extracted_pages JSONB;

ALTER TABLE lecture_file_chunks
ADD COLUMN IF NOT EXISTS start_line INTEGER;

ALTER TABLE lecture_file_chunks
ADD COLUMN IF NOT EXISTS end_line INTEGER;

ALTER TABLE lecture_file_chunks
ADD COLUMN IF NOT EXISTS source_bbox JSONB;

CREATE INDEX IF NOT EXISTS idx_lecture_file_chunks_source_location
ON lecture_file_chunks(lecture_file_id, page_number, start_line);

DROP FUNCTION IF EXISTS match_lecture_chunks(vector, INTEGER, DOUBLE PRECISION, UUID[]);

CREATE OR REPLACE FUNCTION match_lecture_chunks(
  query_embedding vector(1536),
  match_count INTEGER DEFAULT 6,
  min_similarity DOUBLE PRECISION DEFAULT 0.2,
  lecture_filter UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  lecture_id UUID,
  lecture_file_id UUID,
  page_number INTEGER,
  start_line INTEGER,
  end_line INTEGER,
  chunk_index INTEGER,
  content TEXT,
  source_bbox JSONB,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    chunk.id,
    chunk.lecture_id,
    chunk.lecture_file_id,
    chunk.page_number,
    chunk.start_line,
    chunk.end_line,
    chunk.chunk_index,
    chunk.content,
    chunk.source_bbox,
    1 - (chunk.embedding <=> query_embedding) AS similarity
  FROM lecture_file_chunks AS chunk
  WHERE
    (lecture_filter IS NULL OR chunk.lecture_id = ANY(lecture_filter))
    AND 1 - (chunk.embedding <=> query_embedding) >= min_similarity
  ORDER BY chunk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
