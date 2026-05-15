import { OPENROUTER_TEXT_MODELS } from './openrouter-model-options';

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
  | 'cheat_sheet'
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

export type AIModelOption = {
  id: string;
  label: string;
  model: string;
  description: string;
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

const openAITextModels: AIModelOption[] = [
  {
    id: 'gpt-5-5',
    label: 'GPT-5.5',
    model: 'gpt-5.5',
    description: 'Frontier model for the most demanding study workflows.',
  },
  {
    id: 'gpt-5-5-pro',
    label: 'GPT-5.5 Pro',
    model: 'gpt-5.5-pro',
    description: 'Highest-accuracy option for deep reasoning.',
  },
  {
    id: 'gpt-5-2',
    label: 'GPT-5.2',
    model: 'gpt-5.2',
    description: 'Strong general model for analysis and tutoring.',
  },
  {
    id: 'gpt-5-1',
    label: 'GPT-5.1',
    model: 'gpt-5.1',
    description: 'Balanced reasoning and latency.',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    model: 'gpt-5',
    description: 'Reliable reasoning model for broad tasks.',
  },
  {
    id: 'gpt-4-1',
    label: 'GPT-4.1',
    model: 'gpt-4.1',
    description: 'Fast non-reasoning model for structured output.',
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    model: 'gpt-4o-mini',
    description: 'Lower-cost option for lightweight text tasks.',
  },
];

const embeddingModels: Record<AIPlatform, AIModelOption[]> = {
  openai: [
    {
      id: 'text-embedding-3-large',
      label: 'Text embedding 3 large',
      model: 'text-embedding-3-large',
      description: 'Highest-quality OpenAI embedding model.',
    },
    {
      id: 'text-embedding-3-small',
      label: 'Text embedding 3 small',
      model: 'text-embedding-3-small',
      description: 'Lower-cost OpenAI embedding model.',
    },
  ],
  openrouter: [
    {
      id: 'openai-text-embedding-3-large',
      label: 'OpenAI text embedding 3 large',
      model: 'openai/text-embedding-3-large',
      description: 'Highest-quality OpenAI embedding route through OpenRouter.',
    },
    {
      id: 'openai-text-embedding-3-small',
      label: 'OpenAI text embedding 3 small',
      model: 'openai/text-embedding-3-small',
      description: 'Lower-cost OpenAI embedding route through OpenRouter.',
    },
  ],
};

const transcriptionModels: Record<AIPlatform, AIModelOption[]> = {
  openai: [
    {
      id: 'gpt-4o-transcribe',
      label: 'GPT-4o transcribe',
      model: 'gpt-4o-transcribe',
      description: 'High-quality OpenAI speech-to-text model.',
    },
    {
      id: 'gpt-4o-mini-transcribe',
      label: 'GPT-4o mini transcribe',
      model: 'gpt-4o-mini-transcribe',
      description: 'Lower-cost OpenAI speech-to-text model.',
    },
    {
      id: 'whisper-1',
      label: 'Whisper',
      model: 'whisper-1',
      description: 'Classic OpenAI transcription model.',
    },
  ],
  openrouter: [
    {
      id: 'openai-whisper-large-v3',
      label: 'OpenAI Whisper large v3',
      model: 'openai/whisper-large-v3',
      description: 'Whisper route through OpenRouter.',
    },
    {
      id: 'openai-gpt-4o-transcribe',
      label: 'OpenAI GPT-4o transcribe',
      model: 'openai/gpt-4o-transcribe',
      description: 'GPT-4o transcription route through OpenRouter.',
    },
  ],
};

const ttsModels: Record<AIPlatform, AIModelOption[]> = {
  openai: [
    {
      id: 'gpt-4o-mini-tts',
      label: 'GPT-4o mini TTS',
      model: 'gpt-4o-mini-tts',
      description: 'Natural OpenAI speech model.',
    },
    {
      id: 'tts-1',
      label: 'TTS-1',
      model: 'tts-1',
      description: 'Fast OpenAI speech model.',
    },
    {
      id: 'tts-1-hd',
      label: 'TTS-1 HD',
      model: 'tts-1-hd',
      description: 'Higher-quality OpenAI speech model.',
    },
  ],
  openrouter: [
    {
      id: 'openai-gpt-4o-mini-tts',
      label: 'OpenAI GPT-4o mini TTS',
      model: 'openai/gpt-4o-mini-tts',
      description: 'OpenAI speech route through OpenRouter.',
    },
  ],
};

const textModelOptions: Record<AIPlatform, AIModelOption[]> = {
  openai: openAITextModels,
  openrouter: OPENROUTER_TEXT_MODELS,
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
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'question_generation',
    label: 'Question generation',
    hint: 'Short Feynman-style study questions.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'study_plan',
    label: 'Legacy study plan',
    hint: 'Single-pass study plan generation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'study_plan_inventory',
    label: 'Plan inventory',
    hint: 'Concept extraction from source chunks.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'study_plan_synthesis',
    label: 'Plan synthesis',
    hint: 'Learning path assembly and repair passes.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'tutor_chat',
    label: 'Tutor chat',
    hint: 'Streaming Feynman tutor replies.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'answer_grading',
    label: 'Answer grading',
    hint: 'Written and image answer evaluation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'practice_exam',
    label: 'Practice exams',
    hint: 'Practice exam and cluster quiz generation.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'readiness_roadmap',
    label: 'Readiness roadmap',
    hint: 'Exam readiness and next-step prioritization.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
  },
  {
    id: 'cheat_sheet',
    label: 'Cheat sheet',
    hint: 'One-page gap-focused lecture cheat sheets.',
    supportsReasoning: true,
    defaultModels: { openai: 'gpt-5.5', openrouter: 'openai/gpt-5.5' },
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

export const AI_MODEL_OPTIONS: Record<AIUseCase, Record<AIPlatform, AIModelOption[]>> =
  AI_USE_CASES.reduce((acc, useCase) => {
    acc[useCase.id] = useCase.id === 'embeddings'
      ? embeddingModels
      : useCase.id === 'transcription'
        ? transcriptionModels
        : useCase.id === 'tts'
          ? ttsModels
          : textModelOptions;
    return acc;
  }, {} as Record<AIUseCase, Record<AIPlatform, AIModelOption[]>>);

export const getAIModelOptions = (useCase: AIUseCase, platform: AIPlatform) =>
  AI_MODEL_OPTIONS[useCase]?.[platform] ?? [];

export const getDefaultModelForUseCase = (useCase: AIUseCase, platform: AIPlatform) =>
  AI_USE_CASES.find((entry) => entry.id === useCase)?.defaultModels[platform] ??
  getAIModelOptions(useCase, platform)[0]?.model ??
  '';

export const isKnownAIModel = (
  useCase: AIUseCase,
  platform: AIPlatform,
  model: string,
) => getAIModelOptions(useCase, platform).some((option) => option.model === model);
