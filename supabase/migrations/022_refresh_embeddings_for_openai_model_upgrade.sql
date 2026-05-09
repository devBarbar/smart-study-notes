-- Refresh lecture embeddings after moving from text-embedding-3-small to
-- text-embedding-3-large with 1536 dimensions. Existing vectors keep the same
-- SQL shape but are not comparable across embedding models.
TRUNCATE TABLE lecture_file_chunks;
