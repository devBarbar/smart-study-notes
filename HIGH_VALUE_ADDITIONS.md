# High-Value Feature Additions (ranked highest → lowest)

1) Grounded, cited tutoring and answers  (DONE)
   - Problem: the tutor sends full material text to OpenAI and replies without sources, so accuracy and trust depend on the model and token limits.  
   - Addition: store per-page/per-section embeddings in Supabase (pgvector), retrieve top chunks for `feynmanChat`, and render inline citations that jump to the PDF page and canvas area. Show a “source” chip beside AI turns and reuse `answerLinkId` markers for canvas linkage.  
   - Value: reduces hallucinations, cuts token costs, and lets students audit every claim.

2) Move AI + ingestion to secure, queued edge functions  (DONE)
   - Problem: all OpenAI calls and plan generation happen on-device with public keys, heavy payloads, and no retries (`lib/openai.ts`, `app/lecture/new.tsx`).  
   - Addition: wrap `generateStudyPlan`, `evaluateAnswer`, `feynmanChat`, `transcribeAudio`, and `generateLectureMetadata` in Supabase Edge Functions/queue jobs (e.g., a `jobs` table + background worker). Emit status updates via Postgres changes to drive UI spinners instead of long client waits.  
   - Value: protects keys, stabilizes long jobs, enables throttling/observability, and keeps the app responsive.

3) Adaptive mastery & spaced repetition loop  (DONE)
   - Problem: section statuses (`passed/failed/in_progress`) are recorded but not used to schedule practice.  
   - Addition: compute mastery scores per `StudyPlanEntry` from quiz results and recency; surface “review deck” cards, spaced intervals, and streaks. Generate daily quiz sets that mix weak/high-priority concepts, and nudge users to failed items first.  
   - Value: turns the study plan into an outcomes engine instead of a static list.

4) Next-best-action guidance inside study sessions  
   - Problem: users must pick a topic manually; no guidance on where to continue.  
   - Addition: show a “What to do next” banner using plan priority + mastery gaps, one-tap start for the recommended entry, and auto-create/continue a `StudySession` for that entry. Add a session recap (accuracy, time on task, drawings saved) before exiting.  
   - Value: reduces decision fatigue and accelerates completion of high-value sections.

5) Smarter PDF ingestion and exam awareness  
   - Problem: exam files rely on a manual toggle and text extraction may fail silently.  
   - Addition: auto-detect past exams from filename/content signals, extract page-level summaries, and run plan generation with explicit “must-pass” weighting. If extraction fails, queue a retry and show a clear per-file status badge (waiting, parsing, failed).  
   - Value: better study plans with guaranteed coverage of high-yield exam content.

6) Richer study artifacts and export  
   - Problem: notes live only in-app; canvas links are not shareable.  
   - Addition: export session summaries (questions, feedback, canvas snapshots) to PDF/Markdown; allow sharing a read-only link with blurred personal data. Provide per-question “open in canvas” deep links and thumbnail previews in the chat list.  
   - Value: improves retention, collaboration with peers/tutors, and makes the work product portable.

7) Voice-first and accessibility upgrades  (DONE)
   - Problem: voice input exists but the tutor is not conversational-first and TTS is non-streaming.  
   - Addition: add streaming TTS, “listening” mode for follow-ups, captions for all audio, and large-toggle UI for stylus users. Add quick actions (“explain again simpler”, “give analogy”, “show formula”) to reduce typing.  
   - Value: faster interaction on mobile/tablet and better accessibility.

8) Observability, limits, and safety rails  
   - Problem: errors are logged to console only; no guardrails on prompt length or spend.  
   - Addition: central telemetry (Supabase logs/OTEL) for AI latency, token usage, failures; per-user quotas; redaction of PII before sending to OpenAI; and a safety checker to block empty/oversized contexts.  
   - Value: operational stability, predictable costs, and safer handling of user data.

