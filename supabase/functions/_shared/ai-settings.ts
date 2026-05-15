export type AIPlatform = "openai" | "openrouter";
export type AIReasoningEffort = "minimal" | "low" | "medium" | "high";

export type AIUseCase =
  | "lecture_metadata"
  | "question_generation"
  | "study_plan"
  | "study_plan_inventory"
  | "study_plan_synthesis"
  | "tutor_chat"
  | "answer_grading"
  | "practice_exam"
  | "readiness_roadmap"
  | "cheat_sheet"
  | "embeddings"
  | "transcription"
  | "tts";

export type AIModelConfig = {
  platform: AIPlatform;
  model: string;
  reasoningEffort?: AIReasoningEffort | null;
};

export type UserAISettings = {
  modelConfig: Partial<Record<AIUseCase, AIModelConfig>>;
  providerKeys: Partial<Record<AIPlatform, string>>;
};

export type PublicProviderKeyStatus = {
  configured: boolean;
  last4?: string;
};

export type PublicAISettings = {
  modelConfig: Record<AIUseCase, AIModelConfig>;
  providerKeys: Record<AIPlatform, PublicProviderKeyStatus>;
};

const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-5.5";
const OPENAI_REASONING_EFFORT =
  (Deno.env.get("OPENAI_REASONING_EFFORT")?.trim() as AIReasoningEffort | undefined) || "high";
const OPENAI_EMBED_MODEL =
  Deno.env.get("OPENAI_EMBED_MODEL")?.trim() || "text-embedding-3-large";
const OPENAI_TRANSCRIBE_MODEL =
  Deno.env.get("OPENAI_TRANSCRIBE_MODEL")?.trim() || "gpt-4o-transcribe";
const OPENAI_TTS_MODEL =
  Deno.env.get("OPENAI_TTS_MODEL")?.trim() || "gpt-4o-mini-tts";

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const PLATFORMS = new Set(["openai", "openrouter"]);

export const AI_USE_CASE_DEFAULTS: Record<AIUseCase, AIModelConfig> = {
  lecture_metadata: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  question_generation: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  study_plan: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  study_plan_inventory: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: "low",
  },
  study_plan_synthesis: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: "medium",
  },
  tutor_chat: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  answer_grading: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  practice_exam: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  readiness_roadmap: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  cheat_sheet: {
    platform: "openai",
    model: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  },
  embeddings: {
    platform: "openai",
    model: OPENAI_EMBED_MODEL,
    reasoningEffort: null,
  },
  transcription: {
    platform: "openai",
    model: OPENAI_TRANSCRIBE_MODEL,
    reasoningEffort: null,
  },
  tts: {
    platform: "openai",
    model: OPENAI_TTS_MODEL,
    reasoningEffort: null,
  },
};

const textEncoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const getEncryptionKey = async () => {
  const secret = Deno.env.get("AI_SETTINGS_ENCRYPTION_KEY")?.trim();
  if (!secret) {
    throw new Error("Missing AI_SETTINGS_ENCRYPTION_KEY for provider API key storage.");
  }
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const encryptProviderKey = async (apiKey: string) => {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(apiKey),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
};

export const decryptProviderKey = async (ciphertext?: string | null) => {
  if (!ciphertext) return undefined;
  const [version, ivEncoded, encryptedEncoded] = ciphertext.split(":");
  if (version !== "v1" || !ivEncoded || !encryptedEncoded) {
    throw new Error("Unsupported provider API key ciphertext format.");
  }
  const key = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivEncoded) },
    key,
    base64ToBytes(encryptedEncoded),
  );
  return new TextDecoder().decode(decrypted);
};

const sanitizePlatform = (value: unknown, fallback: AIPlatform): AIPlatform => {
  const normalized = String(value ?? "").toLowerCase().trim();
  return PLATFORMS.has(normalized) ? (normalized as AIPlatform) : fallback;
};

const sanitizeReasoningEffort = (
  value: unknown,
  fallback: AIReasoningEffort | null | undefined,
): AIReasoningEffort | null | undefined => {
  if (value === null) return null;
  if (value === undefined) return fallback;
  const normalized = String(value).toLowerCase().trim();
  return REASONING_EFFORTS.has(normalized)
    ? (normalized as AIReasoningEffort)
    : fallback;
};

const sanitizeModel = (value: unknown, fallback: string) => {
  const model = String(value ?? "").trim().slice(0, 160);
  return model || fallback;
};

export const sanitizeModelConfigMap = (
  input: unknown,
): Partial<Record<AIUseCase, AIModelConfig>> => {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, any>;
  const output: Partial<Record<AIUseCase, AIModelConfig>> = {};

  (Object.keys(AI_USE_CASE_DEFAULTS) as AIUseCase[]).forEach((useCase) => {
    const value = raw[useCase];
    if (!value || typeof value !== "object") return;
    const fallback = AI_USE_CASE_DEFAULTS[useCase];
    output[useCase] = {
      platform: sanitizePlatform(value.platform, fallback.platform),
      model: sanitizeModel(value.model, fallback.model),
      reasoningEffort: sanitizeReasoningEffort(
        value.reasoningEffort,
        fallback.reasoningEffort,
      ),
    };
  });

  return output;
};

export const resolveAIModelConfig = (
  settings: UserAISettings | undefined,
  useCase: AIUseCase,
  overrides: Partial<AIModelConfig> = {},
): AIModelConfig => {
  const fallback = AI_USE_CASE_DEFAULTS[useCase];
  const userConfig = settings?.modelConfig?.[useCase];
  return {
    platform: sanitizePlatform(
      overrides.platform ?? userConfig?.platform,
      fallback.platform,
    ),
    model: sanitizeModel(overrides.model ?? userConfig?.model, fallback.model),
    reasoningEffort: sanitizeReasoningEffort(
      overrides.reasoningEffort !== undefined
        ? overrides.reasoningEffort
        : userConfig?.reasoningEffort,
      fallback.reasoningEffort,
    ),
  };
};

const maskKey = (apiKey?: string) => {
  if (!apiKey) return undefined;
  return apiKey.slice(-4);
};

export const toPublicAISettings = (
  settings: UserAISettings | undefined,
): PublicAISettings => {
  const modelConfig = { ...AI_USE_CASE_DEFAULTS } as Record<AIUseCase, AIModelConfig>;
  (Object.keys(AI_USE_CASE_DEFAULTS) as AIUseCase[]).forEach((useCase) => {
    modelConfig[useCase] = resolveAIModelConfig(settings, useCase);
  });

  return {
    modelConfig,
    providerKeys: {
      openai: {
        configured: Boolean(settings?.providerKeys.openai),
        last4: maskKey(settings?.providerKeys.openai),
      },
      openrouter: {
        configured: Boolean(settings?.providerKeys.openrouter),
        last4: maskKey(settings?.providerKeys.openrouter),
      },
    },
  };
};

export const loadUserAISettings = async (
  supabase: any,
  userId: string | null | undefined,
): Promise<UserAISettings> => {
  if (!userId) return { modelConfig: {}, providerKeys: {} };

  const { data, error } = await supabase
    .from("user_ai_settings")
    .select("model_config, openai_api_key_ciphertext, openrouter_api_key_ciphertext")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST116") {
      return { modelConfig: {}, providerKeys: {} };
    }
    throw error;
  }

  if (!data) return { modelConfig: {}, providerKeys: {} };

  return {
    modelConfig: sanitizeModelConfigMap(data.model_config),
    providerKeys: {
      openai: await decryptProviderKey(data.openai_api_key_ciphertext),
      openrouter: await decryptProviderKey(data.openrouter_api_key_ciphertext),
    },
  };
};
