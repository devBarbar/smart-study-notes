import { CheatSheetContent, LanguageCode, Lecture, LectureFile, RoadmapStep, StudyFeedback, StudyPlanEntry, StudyQuestion, StudyReadiness, StudyWarmupQuestion } from '@/types';
import type { AIPlatform } from './ai-model-options';
import { splitTextIntoLineChunks } from './pdf-source';
import { captureTelemetryError, traceAsyncOperation } from './sentry';
import { getSupabase } from './supabase';

export type AIUsageSummary = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ExtractedPdfPage = { pageNumber: number; text: string; lines?: string[] };
export type ExtractedPdfResult = { text: string; pages?: ExtractedPdfPage[]; pageCount?: number };

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

export type AIActionResult<T> = T & {
  costUsd?: number;
  model?: string;
  aiPlatform?: AIPlatform;
  reasoningEffort?: string | null;
  usage?: AIUsageSummary;
};

export const generateLectureMetadata = async (
  files: { name: string; notes?: string }[],
  language: LanguageCode = 'en',
  lectureId?: string
): Promise<AIActionResult<Pick<Lecture, 'title' | 'description'>>> => {
  const jobId = await enqueueJob('metadata', { files, language, lectureId });
  const data = await waitForJobResult<{ title?: string; description?: string; costUsd?: number }>(jobId);
  return {
    title: data?.title ?? 'New Lecture',
    description: data?.description ?? '',
    costUsd: data?.costUsd,
  };
};

export const generateQuestions = async (
  materialTitle: string,
  outline: string,
  count = 3,
  language: LanguageCode = 'en'
): Promise<StudyQuestion[]> => {
  const truncatedOutline = truncateToTokenLimit(outline, 500000);
  const jobId = await enqueueJob('question_generation', {
    materialTitle,
    outline: truncatedOutline,
    count,
    language,
  });
  const data = await waitForJobResult<{ questions?: StudyQuestion[] }>(jobId);
  return Array.isArray(data?.questions) ? data.questions : [];
};

const normalizeWarmupQuestion = (
  question: Partial<StudyWarmupQuestion>,
  index: number,
): StudyWarmupQuestion | null => {
  const prompt = String(question.prompt ?? '').trim();
  const options = Array.isArray(question.options)
    ? question.options.map((option) => String(option ?? '').trim()).filter(Boolean)
    : [];
  const correctOptionIndex = Number(question.correctOptionIndex);

  if (
    !prompt ||
    options.length !== 4 ||
    !Number.isInteger(correctOptionIndex) ||
    correctOptionIndex < 0 ||
    correctOptionIndex >= options.length
  ) {
    return null;
  }

  const shuffled = shuffleWarmupOptions(options, correctOptionIndex);

  return {
    id: question.id || `warmup-${index}`,
    prompt,
    options: shuffled.options,
    correctOptionIndex: shuffled.correctOptionIndex,
    explanation: String(question.explanation ?? '').trim() || options[correctOptionIndex],
    targetConcepts: Array.isArray(question.targetConcepts)
      ? question.targetConcepts.map((concept) => String(concept ?? '').trim()).filter(Boolean)
      : undefined,
  };
};

const shuffleWarmupOptions = (options: string[], correctOptionIndex: number) => {
  const keyed = options.map((option, index) => ({
    option,
    isCorrect: index === correctOptionIndex,
  }));

  for (let index = keyed.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [keyed[index], keyed[swapIndex]] = [keyed[swapIndex], keyed[index]];
  }

  return {
    options: keyed.map((item) => item.option),
    correctOptionIndex: Math.max(0, keyed.findIndex((item) => item.isCorrect)),
  };
};

export const generateWarmupQuestions = async (
  materialTitle: string,
  outline: string,
  count = 10,
  language: LanguageCode = 'en'
): Promise<StudyWarmupQuestion[]> => {
  const truncatedOutline = truncateToTokenLimit(outline, 500000);
  const jobId = await enqueueJob('question_generation', {
    materialTitle,
    outline: truncatedOutline,
    count,
    language,
    format: 'multiple_choice',
  });
  const data = await waitForJobResult<{ questions?: StudyWarmupQuestion[] }>(jobId);
  return Array.isArray(data?.questions)
    ? data.questions
        .map((question, index) => normalizeWarmupQuestion(question, index))
        .filter((question): question is StudyWarmupQuestion => Boolean(question))
    : [];
};

type EvaluateAnswerParams = {
  question: StudyQuestion;
  answerText?: string;
  answerImageDataUrl?: string;
  lectureId?: string;
  gradingContext?: string;
};

export const evaluateAnswer = async (
  { question, answerText, answerImageDataUrl, lectureId, gradingContext }: EvaluateAnswerParams,
  language: LanguageCode = 'en'
): Promise<AIActionResult<StudyFeedback>> => {
  const jobId = await enqueueJob('grade', { question, answerText, answerImageDataUrl, language, lectureId, gradingContext });
  const data = await waitForJobResult<{ feedback?: StudyFeedback; costUsd?: number }>(jobId);

  if (data?.feedback) {
    return {
      summary: data.feedback.summary ?? 'No summary',
      correctness: data.feedback.correctness ?? 'unknown',
      score: data.feedback.score ?? undefined,
      whatWentWrong: data.feedback.whatWentWrong ?? [],
      correctAnswer: data.feedback.correctAnswer ?? undefined,
      rewriteExample: data.feedback.rewriteExample ?? undefined,
      improvements: data.feedback.improvements ?? [],
      misconceptions: data.feedback.misconceptions ?? [],
      followUpQuestion: data.feedback.followUpQuestion ?? undefined,
      sourceNotes: data.feedback.sourceNotes ?? [],
      sourceCitationIds: data.feedback.sourceCitationIds ?? [],
      checkType: data.feedback.checkType ?? undefined,
      canCountForPass: data.feedback.canCountForPass ?? undefined,
      missingPrerequisites: data.feedback.missingPrerequisites ?? [],
      understandingLevel: data.feedback.understandingLevel ?? undefined,
      rubric: data.feedback.rubric ?? undefined,
      costUsd: data?.costUsd,
    };
  }

  return {
    summary: 'Evaluation failed',
    correctness: 'unknown',
    costUsd: data?.costUsd,
  };
};

/**
 * Transcribe audio file to text using OpenAI Whisper API
 */
export const transcribeAudio = async (
  audioUri: string,
  language: LanguageCode = 'en',
  lectureId?: string
): Promise<AIActionResult<{ text: string }>> => {
  // Expect a remote URL or data URL for queued processing
  const jobId = await enqueueJob('transcribe', { audioUrl: audioUri, language, lectureId });
  const data = await waitForJobResult<{ text?: string; costUsd?: number }>(jobId);
  return { text: data?.text ?? '', costUsd: data?.costUsd };
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
  startLine?: number;
  endLine?: number;
  chunkIndex: number;
  content: string;
  contentHash: string;
};

const splitPageIntoChunks = (page: ExtractedPdfPage, maxChars = 1600, overlap = 200): PreparedChunk[] => {
  const segments = splitTextIntoLineChunks(page.text, maxChars, overlap);
  return segments.map((segment, idx) => ({
    lectureId: '',
    lectureFileId: '',
    pageNumber: page.pageNumber,
    startLine: segment.startLine,
    endLine: segment.endLine,
    chunkIndex: idx,
    content: segment.content,
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
): Promise<(PreparedChunk & { embedding: number[] })[]> => {
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
  language: LanguageCode = 'en',
  lectureId?: string
): Promise<AIActionResult<{ message: string }>> => {
  const jobId = await enqueueJob('chat', { messages, materialContext, language, lectureId });
  const data = await waitForJobResult<{
    message?: string;
    costUsd?: number;
    model?: string;
    platform?: AIPlatform;
    reasoningEffort?: string | null;
    usage?: AIUsageSummary;
  }>(jobId);

  return {
    message: data?.message ?? '',
    costUsd: data?.costUsd,
    model: data?.model,
    aiPlatform: data?.platform,
    reasoningEffort: data?.reasoningEffort ?? null,
    usage: data?.usage,
  };
};

export type StreamChatCallbacks = {
  onChunk: (partialText: string) => void;
  onDone?: (result: AIActionResult<{ message: string }>) => void;
  onError?: (error: Error) => void;
};

/**
 * Streaming version of feynmanChat that calls onChunk as tokens arrive
 */
export const streamFeynmanChat = async (
  messages: ChatMessage[],
  materialContext: string,
  language: LanguageCode = 'en',
  lectureId: string | undefined,
  callbacks: StreamChatCallbacks
): Promise<AIActionResult<{ message: string }>> => {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not configured.');

  const jobId = await enqueueJob('chat', { messages, materialContext, language, lectureId });

  return await new Promise<AIActionResult<{ message: string }>>((resolve, reject) => {
    let settled = false;
    let lastPartialResult = '';
    const timeoutMs = 10 * 60 * 1000; // 10 minutes

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.unsubscribe();
      const error = new Error('Job timed out');
      callbacks.onError?.(error);
      reject(error);
    }, timeoutMs);

    const channel = supabase
      .channel(`job-stream-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          if (settled) return;
          const row = payload.new as any;

          // Check for partial_result updates (streaming tokens)
          if (row.partial_result && row.partial_result !== lastPartialResult) {
            lastPartialResult = row.partial_result;
            callbacks.onChunk(row.partial_result);
          }

          // Job completed successfully
          if (row.status === 'succeeded') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            const result: AIActionResult<{ message: string }> = {
              message: row.result?.message ?? lastPartialResult ?? '',
              costUsd: row.result?.costUsd,
              model: row.result?.model,
              aiPlatform: row.result?.platform,
              reasoningEffort: row.result?.reasoningEffort ?? null,
              usage: row.result?.usage,
            };
            callbacks.onDone?.(result);
            resolve(result);
          }

          // Job failed
          if (row.status === 'failed') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            const error = new Error(row.error || 'Job failed');
            callbacks.onError?.(error);
            reject(error);
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'CHANNEL_ERROR' && !settled) {
          settled = true;
          clearTimeout(timer);
          channel.unsubscribe();
          const error = new Error('Job channel error');
          callbacks.onError?.(error);
          reject(error);
        }

        // Once subscribed, check if job already completed (race condition)
        if (status === 'SUBSCRIBED') {
          const { data: current } = await supabase
            .from('jobs')
            .select('status,result,error,partial_result')
            .eq('id', jobId)
            .single();

          if (settled) return;

          if (current?.partial_result && current.partial_result !== lastPartialResult) {
            lastPartialResult = current.partial_result;
            callbacks.onChunk(current.partial_result);
          }

          if (current?.status === 'succeeded') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            const result: AIActionResult<{ message: string }> = {
              message: current.result?.message ?? lastPartialResult ?? '',
              costUsd: current.result?.costUsd,
              model: current.result?.model,
              aiPlatform: current.result?.platform,
              reasoningEffort: current.result?.reasoningEffort ?? null,
              usage: current.result?.usage,
            };
            callbacks.onDone?.(result);
            resolve(result);
          } else if (current?.status === 'failed') {
            settled = true;
            clearTimeout(timer);
            channel.unsubscribe();
            const error = new Error(current.error || 'Job failed');
            callbacks.onError?.(error);
            reject(error);
          }
        }
      });
  });
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
  return traceAsyncOperation(
    `supabase.functions.${functionName}`,
    'function.supabase',
    async () => {
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
        const message = await response.text();
        const error = new Error(message || `Supabase function ${functionName} failed.`);
        captureTelemetryError(error, {
          tags: { area: 'supabase_function', function_name: functionName },
          extra: { status: response.status },
        });
        throw error;
      }

      return (await response.json()) as T;
    },
    { 'supabase.function': functionName }
  );
};

const enqueueJob = async (type: string, payload: any): Promise<string> => {
  const data = await callSupabaseFunction<{ jobId: string }>('enqueue-job', { type, payload });
  if (!data?.jobId) {
    throw new Error('Failed to enqueue job');
  }
  callSupabaseFunction('process-job', { source: 'client-fallback', jobId: data.jobId }).catch((error) => {
    console.warn('[openai] process-job fallback kick failed', error);
  });
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
  
  const response = await traceAsyncOperation(
    'supabase.functions.extract-pdf-text',
    'function.supabase',
    () =>
      fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ pdfUrl }),
      }),
    { 'supabase.function': 'extract-pdf-text' }
  );

  if (!response.ok) {
    const error = await response.text();
    const extractionError = new Error(`PDF extraction failed: ${error}`);
    captureTelemetryError(extractionError, {
      tags: { area: 'supabase_function', function_name: 'extract-pdf-text' },
      extra: { status: response.status },
    });
    throw extractionError;
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
          lines: Array.isArray(page.lines)
            ? page.lines.map((line: unknown) => sanitizeForDatabase(String(line ?? ''))).filter(Boolean)
            : undefined,
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
  lectureId?: string;
};

/**
 * Generate a study plan from extracted PDF content, weighting past exams
 */
export const generateStudyPlan = async (
  extractedTexts: StudyPlanSource[],
  language: LanguageCode = 'en',
  options: StudyPlanOptions = {}
): Promise<AIActionResult<{ entries: Omit<StudyPlanEntry, 'id' | 'lectureId' | 'createdAt'>[] }>> => {
  const { lectureId, ...rest } = options;
  const jobId = await enqueueJob('plan', { extractedTexts, language, options: rest, lectureId });
  const data = await waitForJobResult<{
    entries?: Omit<StudyPlanEntry, 'id' | 'lectureId' | 'createdAt'>[];
    costUsd?: number;
  }>(jobId);

  return { entries: data?.entries ?? [], costUsd: data?.costUsd };
};

type ClusterQuizResult = {
  category: string;
  score: number;
  passed: boolean;
  questionCount: number;
};

type RoadmapRequest = {
  planEntries: StudyPlanEntry[];
  additionalNotes?: string;
  progress: { passed: number; inProgress: number; notStarted: number; failed: number };
  language?: LanguageCode;
  lectureId?: string;
  /** Cluster quiz results to factor into readiness calculation */
  clusterQuizResults?: ClusterQuizResult[];
};

export const generateReadinessAndRoadmap = async (
  { planEntries, additionalNotes, progress, language = 'en', lectureId, clusterQuizResults = [] }: RoadmapRequest
): Promise<{ readiness: StudyReadiness; roadmap: RoadmapStep[] }> => {
  const jobId = await enqueueJob('readiness_roadmap', {
    planEntries,
    additionalNotes,
    progress,
    language,
    lectureId,
    clusterQuizResults,
  });
  const data = await waitForJobResult<{
    readiness?: StudyReadiness;
    roadmap?: RoadmapStep[];
  }>(jobId);
  return {
    readiness: data.readiness ?? {
      percentage: 0,
      predictedGrade: 'Failed',
      summary: 'Readiness could not be generated.',
      focusAreas: [],
      updatedAt: new Date().toISOString(),
    },
    roadmap: Array.isArray(data.roadmap) ? data.roadmap : [],
  };
};

export const enqueueCheatSheetRefresh = async (params: {
  lectureId: string;
  language?: LanguageCode;
  force?: boolean;
}): Promise<string> =>
  enqueueJob('cheat_sheet', {
    lectureId: params.lectureId,
    language: params.language ?? 'en',
    force: params.force ?? false,
  });

export const generateCheatSheet = async (params: {
  lectureId: string;
  language?: LanguageCode;
  force?: boolean;
}): Promise<{ content?: CheatSheetContent; skipped?: boolean }> => {
  const jobId = await enqueueCheatSheetRefresh(params);
  const data = await waitForJobResult<{ content?: CheatSheetContent; skipped?: boolean }>(jobId);
  return data ?? {};
};

export const generatePracticeExam = async (params: {
  lectureId: string;
  questionCount?: number;
  language?: LanguageCode;
  title?: string;
  /** When set, creates a cluster quiz scoped to this category */
  category?: string;
}) => {
  const { lectureId, questionCount = 5, language = 'en', title, category } = params;
  const { practiceExamId, jobId } = await callSupabaseFunction<{
    practiceExamId: string;
    jobId: string;
  }>('generate-practice-exam', { lectureId, questionCount, language, title, category });

  callSupabaseFunction('process-job', { source: 'client-fallback-practice-exam', jobId }).catch((error) => {
    console.warn('[openai] practice exam process-job fallback kick failed', error);
  });

  const result = await waitForJobResult<{ practiceExamId: string; questionCount: number; category?: string }>(jobId);
  return {
    practiceExamId: result?.practiceExamId ?? practiceExamId,
    questionCount: result?.questionCount ?? questionCount,
    category: result?.category ?? category,
    jobId,
  };
};
