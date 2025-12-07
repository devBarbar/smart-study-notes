# Supabase Edge Functions (AI)

## Required secrets
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, defaults to `gpt-5.1`)
- `OPENAI_EMBED_MODEL` (optional, defaults to `text-embedding-3-small`)

Set them once per project:
```
supabase secrets set OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-5.1 OPENAI_EMBED_MODEL=text-embedding-3-small
```

## Deploy checklist
1) Install deps: `npm install` (for any shared deps you add later)  
2) Deploy functions (including queue + worker):
```
supabase functions deploy extract-pdf-text enqueue-job process-job
```
3) (Optional) keep legacy direct endpoints deployed if still needed:
```
supabase functions deploy embed-texts generate-lecture-metadata generate-study-plan feynman-chat evaluate-answer transcribe-audio
```
4) Confirm logs: `supabase functions list` and `supabase functions logs --project-ref <ref>`

## Local testing
```
supabase functions serve embed-texts --env-file supabase/.env.local
```
Use the CLI-provided URL in the Expo app by setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## Worker scheduling
- Create a Supabase cron job to run `process-job` every minute (or as needed):
```
supabase cron create process-job --schedule "*/1 * * * *" --function process-job
```
- The worker uses service role permissions to pick the oldest pending job, mark it running, and write results back to `jobs` (RLS allows service_role updates). Clients subscribe to `jobs` changes via realtime.

