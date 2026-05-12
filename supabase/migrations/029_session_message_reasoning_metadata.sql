ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS reasoning JSONB;

CREATE INDEX IF NOT EXISTS idx_session_messages_reasoning
ON session_messages
USING GIN (reasoning);
