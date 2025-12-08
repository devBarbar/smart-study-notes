export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type ModelPricing = {
  inputPer1K: number;
  outputPer1K: number;
};

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const parseEnvPrice = (key: string, fallback: number) => {
  const raw = Deno.env.get(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeModelKey = (model: string) => model.toLowerCase();

const BASE_PRICING: Record<string, ModelPricing> = {
  // Defaults based on OpenAI public pricing (USD per 1K tokens)
  "gpt-5.1": { inputPer1K: 0.003, outputPer1K: 0.012 },
  "gpt-4.1": { inputPer1K: 0.0025, outputPer1K: 0.01 },
  "gpt-4o": { inputPer1K: 0.005, outputPer1K: 0.015 },
  "gpt-4o-mini": { inputPer1K: 0.0003, outputPer1K: 0.0006 },
  "text-embedding-3-small": { inputPer1K: 0.00002, outputPer1K: 0 },
  "text-embedding-3-large": { inputPer1K: 0.00013, outputPer1K: 0 },
  default: { inputPer1K: 0.003, outputPer1K: 0.006 },
};

const applyEnvOverrides = (modelKey: string, pricing: ModelPricing): ModelPricing => {
  const prefix = `OPENAI_PRICE_${modelKey.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
  const inputPer1K = parseEnvPrice(`${prefix}_INPUT`, pricing.inputPer1K);
  const outputPer1K = parseEnvPrice(`${prefix}_OUTPUT`, pricing.outputPer1K);
  return { inputPer1K, outputPer1K };
};

export const getModelPricing = (model: string): ModelPricing => {
  const key = normalizeModelKey(model || "default");
  const base = BASE_PRICING[key] ?? BASE_PRICING.default;
  return applyEnvOverrides(key, base);
};

export const calculateTokenCostUSD = (
  model: string,
  usage: TokenUsage
): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
} => {
  const { inputPer1K, outputPer1K } = getModelPricing(model || "default");
  const promptTokens = Math.max(0, usage.promptTokens ?? usage.totalTokens ?? 0);
  const completionTokens = Math.max(
    0,
    usage.completionTokens ?? (usage.totalTokens ? Math.max(0, usage.totalTokens - promptTokens) : 0),
  );
  const totalTokens = promptTokens + completionTokens;

  const inputCost = roundCurrency((promptTokens / 1000) * inputPer1K);
  const outputCost = roundCurrency((completionTokens / 1000) * outputPer1K);
  const totalCost = roundCurrency(inputCost + outputCost);

  return { promptTokens, completionTokens, totalTokens, inputCost, outputCost, totalCost };
};

export const calculateWhisperCostUSD = (audioSeconds: number): number => {
  const perMinute = parseEnvPrice("OPENAI_PRICE_WHISPER_PER_MIN", 0.006);
  const minutes = Math.max(0, audioSeconds) / 60;
  return roundCurrency(minutes * perMinute);
};
