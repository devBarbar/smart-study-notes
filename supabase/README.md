# Supabase Edge Functions (AI)

## Required secrets
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, defaults to `gpt-5.5`)
- `OPENAI_REASONING_EFFORT` (optional, defaults to `high`)
- `OPENAI_EMBED_MODEL` (optional, defaults to `text-embedding-3-large`)
- `OPENAI_EMBED_DIMENSIONS` (optional, defaults to `1536`)
- `OPENAI_TRANSCRIBE_MODEL` (optional, defaults to `gpt-4o-transcribe`)
- `OPENAI_TTS_MODEL` (optional, defaults to `gpt-4o-mini-tts`)
- `OPENROUTER_API_KEY` (optional server fallback; users can also save their own key in Settings)
- `OPENROUTER_HTTP_REFERER` (optional OpenRouter attribution header)
- `OPENROUTER_APP_TITLE` (optional OpenRouter attribution header)
- `AI_SETTINGS_ENCRYPTION_KEY` (required to save per-user provider keys)

Set them once per project:
```
supabase secrets set OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-5.5 OPENAI_REASONING_EFFORT=high OPENAI_EMBED_MODEL=text-embedding-3-large OPENAI_EMBED_DIMENSIONS=1536 OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe OPENAI_TTS_MODEL=gpt-4o-mini-tts AI_SETTINGS_ENCRYPTION_KEY=<random-32-byte-secret>
```

## Deploy checklist
1) Install deps: `npm install` (for any shared deps you add later)  
2) Deploy functions (including queue + worker + TTS + AI settings):
```
supabase functions deploy extract-pdf-text enqueue-job process-job stream-tts ai-settings generate-practice-exam
```
3) (Optional) keep legacy direct endpoints deployed if still needed:
```
supabase functions deploy embed-texts generate-lecture-metadata generate-study-plan feynman-chat evaluate-answer transcribe-audio
```

## Troubleshooting TTS (Text-to-Speech)
If the AI tutor voice sounds robotic, it's falling back to expo-speech. To use natural OpenAI voices:
1. Ensure `stream-tts` is deployed: `supabase functions deploy stream-tts`
2. Verify OPENAI_API_KEY is set: `supabase secrets list`
3. Check function logs: `supabase functions logs stream-tts --project-ref <ref>`
4) Confirm logs: `supabase functions list` and `supabase functions logs --project-ref <ref>`

## Local testing
```
supabase functions serve embed-texts --env-file supabase/.env.local
```
Use the CLI-provided URL in the Expo app by setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Worker scheduling
- `enqueue-job` triggers `process-job` immediately after it creates a queued job.
- Do not run a high-frequency cron against `process-job`; idle polling consumes Edge Function invocations even when nobody is using the app.
- The worker uses service role permissions to pick the oldest pending job, mark it running, and write results back to `jobs` (RLS allows service_role updates). Clients subscribe to `jobs` changes via realtime.
