-- Per-user AI provider/model settings.
-- API keys are written only through the ai-settings Edge Function, where they are encrypted
-- before storage. No RLS policies are added on purpose: clients should not read ciphertext
-- directly; service-role Edge Functions mediate access.

CREATE TABLE IF NOT EXISTS user_ai_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  model_config JSONB NOT NULL DEFAULT '{}'::JSONB,
  openai_api_key_ciphertext TEXT,
  openrouter_api_key_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_user_ai_settings_updated_at
ON user_ai_settings(updated_at DESC);

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_type_check
  CHECK (
    type = ANY (
      ARRAY[
        'plan'::TEXT,
        'chat'::TEXT,
        'grade'::TEXT,
        'transcribe'::TEXT,
        'metadata'::TEXT,
        'embed'::TEXT,
        'practice_exam'::TEXT,
        'lecture_plan_v2'::TEXT,
        'lecture_plan_inventory'::TEXT,
        'lecture_plan_synthesize'::TEXT,
        'question_generation'::TEXT,
        'readiness_roadmap'::TEXT
      ]
    )
  );
