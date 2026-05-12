import { getSupabase } from './supabase';

export type AIPlatform = 'openai' | 'openrouter';
export type AIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export type AIUseCase =
  | 'lecture_metadata'
  | 'question_generation'
  | 'study_plan'
  | 'study_plan_inventory'
  | 'study_plan_synthesis'
  | 'tutor_chat'
  | 'answer_grading'
  | 'practice_exam'
  | 'readiness_roadmap'
  | 'embeddings'
  | 'transcription'
  | 'tts';

export type AIModelConfig = {
  platform: AIPlatform;
  model: string;
  reasoningEffort?: AIReasoningEffort | null;
};

export type AISettingsResponse = {
  modelConfig: Record<AIUseCase, AIModelConfig>;
  providerKeys: Record<AIPlatform, { configured: boolean; last4?: string }>;
};

export type AISettingsUpdate = {
  modelConfig?: Partial<Record<AIUseCase, AIModelConfig>>;
  apiKeys?: Partial<Record<AIPlatform, string>>;
};

export const AI_REASONING_OPTIONS: Array<{
  value: AIReasoningEffort | null;
  label: string;
}> = [
  { value: null, label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const AI_PLATFORM_LABELS: Record<AIPlatform, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

export const AI_USE_CASES: Array<{
  id: AIUseCase;
  label: string;
  hint: string;
  supportsReasoning: boolean;
  defaultModels: Record<AIPlatform, string>;
}> = [
  {
    id: 'lecture_metadata',
    label: 'Lecture metadata',
    hint: 'Titles and descriptions for uploaded material.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'question_generation',
    label: 'Question generation',
    hint: 'Short Feynman-style study questions.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'study_plan',
    label: 'Legacy study plan',
    hint: 'Single-pass study plan generation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'study_plan_inventory',
    label: 'Plan inventory',
    hint: 'Concept extraction from source chunks.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'study_plan_synthesis',
    label: 'Plan synthesis',
    hint: 'Learning path assembly and repair passes.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'tutor_chat',
    label: 'Tutor chat',
    hint: 'Streaming Feynman tutor replies.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'answer_grading',
    label: 'Answer grading',
    hint: 'Written and image answer evaluation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'practice_exam',
    label: 'Practice exams',
    hint: 'Practice exam and cluster quiz generation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'readiness_roadmap',
    label: 'Readiness roadmap',
    hint: 'Exam readiness and next-step prioritization.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.2' },
  },
  {
    id: 'embeddings',
    label: 'Embeddings',
    hint: 'Semantic search over lecture chunks.',
    supportsReasoning: false,
    defaultModels: {
      openai: 'text-embedding-3-large',
      openrouter: 'openai/text-embedding-3-large',
    },
  },
  {
    id: 'transcription',
    label: 'Transcription',
    hint: 'Voice note and spoken-answer transcription.',
    supportsReasoning: false,
    defaultModels: { openai: 'gpt-4o-transcribe', openrouter: 'openai/whisper-large-v3' },
  },
  {
    id: 'tts',
    label: 'Text to speech',
    hint: 'Tutor voice playback.',
    supportsReasoning: false,
    defaultModels: { openai: 'gpt-4o-mini-tts', openrouter: 'openai/gpt-4o-mini-tts' },
  },
];

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const getAccessToken = async (): Promise<string | null> => {
  const supabase = getSupabase();
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: null };
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
};

const callAISettingsFunction = async <T>(
  payload: Record<string, unknown>,
): Promise<T> => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase functions are not configured.');
  }
  const accessToken = await getAccessToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken ?? SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'AI settings request failed.');
  }
  return (await response.json()) as T;
};

export const getAISettings = async () =>
  callAISettingsFunction<AISettingsResponse>({ action: 'get' });

export const updateAISettings = async (settings: AISettingsUpdate) =>
  callAISettingsFunction<AISettingsResponse>({
    action: 'update',
    modelConfig: settings.modelConfig,
    apiKeys: settings.apiKeys,
  });
