import { LanguageCode, Lecture, LectureFile, RoadmapStep, StudyFeedback, StudyPlanEntry, StudyQuestion, StudyReadiness } from '@/types';
import { questionPrompt } from './prompts';
import { getSupabase } from './supabase';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-5.1';

type ChatCompletionContent = {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ExtractedPdfPage = { pageNumber: number; text: string };
export type ExtractedPdfResult = { text: string; pages?: ExtractedPdfPage[]; pageCount?: number };

const callChat = async (content: ChatCompletionContent[]) => {
  ensureKey();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content as string;
};

const stripCodeFences = (text: string) => {
  const fenceMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
};

/**
 * Sanitize text for PostgreSQL storage - removes null characters and other problematic Unicode
 */
const sanitizeForDatabase = (text: string): string => {
  // Remove null characters (\u0000) which PostgreSQL TEXT columns cannot store
  // Also remove other control characters that might cause issues
  return text
    .replace(/\u0000/g, '') // Null character
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Other control characters except \t, \n, \r
    .trim();
};

export const generateLectureMetadata = async (
  files: { name: string; notes?: string }[],
  language: LanguageCode = 'en'
): Promise<Pick<Lecture, 'title' | 'description'>> => {
  const jobId = await enqueueJob('metadata', { files, language });
  const data = await waitForJobResult<{ title?: string; description?: string }>(jobId);
  return {
    title: data?.title ?? 'New Lecture',
    description: data?.description ?? '',
  };
};

export const generateQuestions = async (
  materialTitle: string,
  outline: string,
  count = 3,
  language: LanguageCode = 'en'
): Promise<StudyQuestion[]> => {
  // Truncate outline if too long to prevent token limit issues
  const truncatedOutline = truncateToTokenLimit(outline, 500000);
  const prompt = questionPrompt(materialTitle, truncatedOutline, count, language);
  const content: ChatCompletionContent[] = [{ type: 'text', text: prompt }];
  const output = await callChat(content);
  const lines = output
    .split('\n')
    .map((line) => line.replace(/^\d+[\).\s]*/, '').trim())
    .filter(Boolean);

  return lines.map((line, idx) => ({
    id: `q-${idx}`,
    prompt: line,
  }));
};

type EvaluateAnswerParams = {
  question: StudyQuestion;
  answerText?: string;
  answerImageDataUrl?: string;
};

export const evaluateAnswer = async (
  { question, answerText, answerImageDataUrl }: EvaluateAnswerParams,
  language: LanguageCode = 'en'
): Promise<StudyFeedback> => {
  const jobId = await enqueueJob('grade', { question, answerText, answerImageDataUrl, language });
  const data = await waitForJobResult<{ feedback?: StudyFeedback }>(jobId);

  if (data?.feedback) {
    return {
      summary: data.feedback.summary ?? 'No summary',
      correctness: data.feedback.correctness ?? 'unknown',
      score: data.feedback.score ?? undefined,
      improvements: data.feedback.improvements ?? [],
    };
  }

  return {
    summary: 'Evaluation failed',
    correctness: 'unknown',
  };
};

/**
 * Transcribe audio file to text using OpenAI Whisper API
 */
export const transcribeAudio = async (audioUri: string, language: LanguageCode = 'en'): Promise<string> => {
  // Expect a remote URL or data URL for queued processing
  const jobId = await enqueueJob('transcribe', { audioUrl: audioUri, language });
  const data = await waitForJobResult<{ text?: string }>(jobId);
  return data?.text ?? '';
};

/**
 * Truncate text to approximately fit within token limits
 * Rough estimate: 1 token ≈ 4 characters for English text
 */
const truncateToTokenLimit = (text: string, maxTokens: number): string => {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  
  // Truncate and add indicator
  const truncated = text.slice(0, maxChars);
  // Try to cut at a sentence or paragraph boundary
  const lastParagraph = truncated.lastIndexOf('\n\n');
  const lastSentence = truncated.lastIndexOf('. ');
  const cutPoint = Math.max(lastParagraph, lastSentence, maxChars - 500);
  
  return truncated.slice(0, cutPoint) + '\n\n[... Content truncated for length. Key information above covers the main topics ...]';
};

/**
 * Split long text into manageable, overlapping chunks to avoid truncation.
 */
const chunkText = (text: string, maxChars = 12000, overlap = 500): string[] => {
  if (text.length <= maxChars) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const sliceEnd = Math.min(start + maxChars, text.length);
    let chunk = text.slice(start, sliceEnd);

    // Prefer to cut at paragraph boundaries when possible
    if (sliceEnd < text.length) {
      const lastBreak = chunk.lastIndexOf('\n\n');
      if (lastBreak > maxChars * 0.6) {
        chunk = chunk.slice(0, lastBreak);
      }
    }

    const trimmed = chunk.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }

    const advanceBy = chunk.length > overlap ? chunk.length - overlap : chunk.length;
    if (advanceBy <= 0) break;
    start += advanceBy;
  }

  return chunks;
};

const hashText = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash |= 0; // Force 32bit
  }
  return `h${(hash >>> 0).toString(16)}`;
};

type PreparedChunk = {
  lectureId: string;
  lectureFileId: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  contentHash: string;
};

const splitPageIntoChunks = (page: ExtractedPdfPage, maxChars = 1600, overlap = 200): PreparedChunk[] => {
  const segments = chunkText(page.text, maxChars, overlap);
  return segments.map((segment, idx) => ({
    lectureId: '',
    lectureFileId: '',
    pageNumber: page.pageNumber,
    chunkIndex: idx,
    content: segment,
    contentHash: '',
  }));
};

const embedTexts = async (inputs: string[]): Promise<number[][]> => {
  const jobId = await enqueueJob('embed', { inputs });
  const data = await waitForJobResult<{ embeddings?: number[][] }>(jobId);

  if (!Array.isArray(data?.embeddings)) {
    throw new Error('Embedding response was invalid.');
  }

  return data.embeddings;
};

export const buildLectureChunks = async (
  lectureId: string,
  file: LectureFile,
  pages?: ExtractedPdfPage[]
): Promise<Array<PreparedChunk & { embedding: number[] }>> => {
  const sourcePages: ExtractedPdfPage[] =
    pages && pages.length > 0
      ? pages
      : [
          {
            pageNumber: 1,
            text: file.extractedText ?? '',
          },
        ];

  const pendingChunks: PreparedChunk[] = [];

  sourcePages.forEach((page) => {
    const pageChunks = splitPageIntoChunks(page);
    pageChunks.forEach((chunk) => {
      const content = sanitizeForDatabase(chunk.content)?.trim();
      if (!content) return;
      pendingChunks.push({
        ...chunk,
        lectureId,
        lectureFileId: file.id,
        content,
        contentHash: hashText(`${file.id}:${chunk.pageNumber}:${chunk.chunkIndex}:${content}`),
      });
    });
  });

  if (pendingChunks.length === 0) return [];

  const embeddings = await embedTexts(pendingChunks.map((c) => c.content));

  return pendingChunks.map((chunk, idx) => ({
    ...chunk,
    embedding: embeddings[idx],
  }));
};

export const embedQuery = async (text: string): Promise<number[]> => {
  const vectors = await embedTexts([text]);
  return vectors[0] ?? [];
};

/**
 * Feynman-style tutoring chat that maintains conversation context
 */
export const feynmanChat = async (
  messages: ChatMessage[],
  materialContext: string,
  language: LanguageCode = 'en'
): Promise<string> => {
  const jobId = await enqueueJob('chat', { messages, materialContext, language });
  const data = await waitForJobResult<{ message?: string }>(jobId);

  return data?.message ?? '';
};

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const ensureSupabaseFunctionConfig = () => {
  if (!SUPABASE_URL) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL for Supabase functions.');
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY for Supabase functions.');
  }
  return { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY };
};

const getAccessToken = async (): Promise<string | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
};

const callSupabaseFunction = async <T = any>(
  functionName: string,
  payload: BodyInit | Record<string, unknown>,
  options: { isFormData?: boolean } = {}
): Promise<T> => {
  const { supabaseUrl, supabaseAnonKey } = ensureSupabaseFunctionConfig();
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken ?? supabaseAnonKey}`,
    apikey: supabaseAnonKey,
  };
  const body = options.isFormData ? (payload as BodyInit) : JSON.stringify(payload);
  if (!options.isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Supabase function ${functionName} failed.`);
  }

  return (await response.json()) as T;
};

const enqueueJob = async (type: string, payload: any): Promise<string> => {
  const data = await callSupabaseFunction<{ jobId: string }>('enqueue-job', { type, payload });
  if (!data?.jobId) {
    throw new Error('Failed to enqueue job');
  }
  return data.jobId;
};

const waitForJobResult = async <T = any>(jobId: string, timeoutMs = 10 * 60 * 1000): Promise<T> => {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not configured.');

  // Check current status first
  const { data: initial, error: initialError } = await supabase
    .from('jobs')
    .select('status,result,error')
    .eq('id', jobId)
    .single();

  if (initialError) {
    throw new Error(initialError.message);
  }

  if (initial?.status === 'succeeded') {
    return initial.result as T;
  }
  if (initial?.status === 'failed') {
    throw new Error(initial.error || 'Job failed');
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.unsubscribe();
      reject(new Error('Job timed out'));
    }, timeoutMs);

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          if (settled) return;
          const row = payload.new as any;
          if (row.status === 'succeeded') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            resolve(row.result as T);
          } else if (row.status === 'failed') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            reject(new Error(row.error || 'Job failed'));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && !settled) {
          settled = true;
          clearTimeout(timer);
          channel.unsubscribe();
          reject(new Error('Job channel error'));
        }
      });
  });
};

/**
 * Extract text content from a PDF using the Supabase Edge Function
 */
export const extractPdfText = async (pdfUrl: string): Promise<ExtractedPdfResult> => {
  const { supabaseUrl, supabaseAnonKey } = ensureSupabaseFunctionConfig();
  const functionUrl = `${supabaseUrl}/functions/v1/extract-pdf-text`;
  
  console.log('[openai] Extracting PDF text from:', pdfUrl);
  
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ pdfUrl }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PDF extraction failed: ${error}`);
  }

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || 'Failed to extract PDF text');
  }

  console.log('[openai] PDF extraction complete, pages:', data.pageCount);
  
  const sanitizedText = sanitizeForDatabase(data.text);

  const pages: ExtractedPdfPage[] | undefined = Array.isArray(data.pages)
    ? data.pages
        .map((page: any, idx: number) => ({
          pageNumber: page.pageNumber ?? page.page ?? idx + 1,
          text: sanitizeForDatabase(page.text ?? '') ?? '',
        }))
        .filter((p: ExtractedPdfPage) => p.text.length > 0)
    : undefined;

  return {
    text: sanitizedText,
    pages,
    pageCount: data.pageCount,
  };
};

type StudyPlanSource = { fileName: string; text: string; isExam?: boolean };
type StudyPlanOptions = {
  additionalNotes?: string;
  thresholds?: { pass: number; good: number; ace: number };
};

/**
 * Generate a study plan from extracted PDF content, weighting past exams
 */
export const generateStudyPlan = async (
  extractedTexts: StudyPlanSource[],
  language: LanguageCode = 'en',
  options: StudyPlanOptions = {}
): Promise<Omit<StudyPlanEntry, 'id' | 'lectureId' | 'createdAt'>[]> => {
  const jobId = await enqueueJob('plan', { extractedTexts, language, options });
  const data = await waitForJobResult<{
    entries?: Omit<StudyPlanEntry, 'id' | 'lectureId' | 'createdAt'>[];
  }>(jobId);

  return data?.entries ?? [];
};

type RoadmapRequest = {
  planEntries: StudyPlanEntry[];
  additionalNotes?: string;
  thresholds: { pass: number; good: number; ace: number };
  progress: { passed: number; inProgress: number; notStarted: number; failed: number };
  language?: LanguageCode;
};

export const generateReadinessAndRoadmap = async (
  { planEntries, additionalNotes, thresholds, progress, language = 'en' }: RoadmapRequest
): Promise<{ readiness: StudyReadiness; roadmap: RoadmapStep[] }> => {
  const total = Math.max(planEntries.length, 1);
  const completionRatio =
    (progress.passed + progress.inProgress * 0.6 + progress.failed * 0.3) / total;
  const fallbackPass = Math.max(5, Math.min(95, Math.round(30 + completionRatio * 60)));
  const fallbackGood = Math.max(10, Math.min(98, Math.round(40 + completionRatio * 55)));
  const fallbackAce = Math.max(12, Math.min(99, Math.round(50 + completionRatio * 50)));

  const planSummary = planEntries
    .map((entry, idx) => {
      const status = (entry.status ?? 'not_started').replace('_', ' ');
      return `${idx + 1}. ${entry.title} [${entry.importanceTier ?? 'core'} | priority ${
        entry.priorityScore ?? 0
      } | status ${status}${entry.category ? ` | ${entry.category}` : ''}]`;
    })
    .join('\n');

  const notesBlock = additionalNotes
    ? `Instructor / additional notes:\n${truncateToTokenLimit(additionalNotes, 2000)}\n`
    : '';

  const prompt = `You are an exam readiness coach. Given a study plan with progress, produce an updated probability of achieving three goals and a focused roadmap that maximizes passing first, then solid (good), then ace.

Goals (confidence targets):
- Pass: ${thresholds.pass}%
- Good: ${thresholds.good}%
- Ace: ${thresholds.ace}%

Progress counts:
- Passed: ${progress.passed}
- In progress: ${progress.inProgress}
- Not started: ${progress.notStarted}
- Failed: ${progress.failed}
- Total sections: ${planEntries.length}

Study plan entries:
${planSummary || 'No plan entries provided.'}

${notesBlock}

Return JSON ONLY with this shape:
{
  "probabilities": { "pass": 0-100, "good": 0-100, "ace": 0-100 },
  "summary": "1-2 sentence overview",
  "focusAreas": ["short bullets to improve next"],
  "roadmap": [
    {
      "order": 1,
      "title": "Topic or cluster",
      "action": "Specific next actions (1-2 sentences)",
      "target": "pass | good | ace",
      "reason": "Why this now",
      "category": "Category name",
      "estimatedMinutes": 20-90
    }
  ]
}

Rules:
- Put pass-critical items first, then steps toward good, then ace polish.
- Keep roadmap to 5-8 steps max.`;

  let parsed: any = null;
  try {
    const output = await callChat([{ type: 'text', text: prompt }]);
    const clean = stripCodeFences(output);
    parsed = JSON.parse(clean);
  } catch (err) {
    console.warn('[openai] readiness/roadmap parse failed, using fallback', err);
  }

  const clampPercent = (value: any, fallback: number) => {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return Math.max(0, Math.min(100, Math.round(num)));
    }
    return fallback;
  };

  const readiness: StudyReadiness = {
    pass: clampPercent(parsed?.probabilities?.pass, fallbackPass),
    good: clampPercent(parsed?.probabilities?.good, fallbackGood),
    ace: clampPercent(parsed?.probabilities?.ace, fallbackAce),
    summary: parsed?.summary || 'AI-estimated readiness based on current progress.',
    focusAreas: Array.isArray(parsed?.focusAreas)
      ? parsed.focusAreas.filter(Boolean).map((f: any) => String(f))
      : ['Focus on core topics first, then high-yield, then stretch.'],
    updatedAt: new Date().toISOString(),
  };

  const roadmapSource = Array.isArray(parsed?.roadmap) ? parsed.roadmap : [];
  const fallbackRoadmap = planEntries
    .slice(0, 6)
    .map((entry, idx) => ({
      order: idx + 1,
      title: entry.title,
      action: entry.description || 'Study this topic and practice 2-3 questions.',
      target: entry.importanceTier === 'stretch' ? 'ace' : entry.importanceTier === 'high-yield' ? 'good' : 'pass',
      reason: 'Derived from study plan priority.',
      category: entry.category,
      estimatedMinutes: 45,
    }));

  const roadmap: RoadmapStep[] =
    roadmapSource.length > 0
      ? roadmapSource.map((step: any, idx: number) => ({
          order: typeof step.order === 'number' ? step.order : idx + 1,
          title: step.title || `Step ${idx + 1}`,
          action: step.action || step.next || 'Review and practice.',
          target:
            step.target === 'good' || step.target === 'ace'
              ? step.target
              : 'pass',
          reason: step.reason || step.rationale || undefined,
          category: step.category || step.section || undefined,
          estimatedMinutes: Number.isFinite(Number(step.estimatedMinutes))
            ? Math.max(10, Math.min(180, Math.round(Number(step.estimatedMinutes))))
            : undefined,
        }))
      : fallbackRoadmap;

  return { readiness, roadmap };
};
