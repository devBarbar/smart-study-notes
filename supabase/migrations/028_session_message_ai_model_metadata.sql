ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS ai_model TEXT;

ALTER TABLE session_messages
ADD COLUMN IF NOT EXISTS ai_platform TEXT
CHECK (ai_platform IS NULL OR ai_platform IN ('openai', 'openrouter'));
