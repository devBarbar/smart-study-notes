import { calculateTokenCostUSD, TokenUsage } from "./pricing.ts";
import {
  AIModelConfig,
  AIUseCase,
  resolveAIModelConfig,
  UserAISettings,
} from "./ai-settings.ts";
import {
  buildEmbeddingRequestBody,
  extractChatCompletionText,
  extractResponseText,
  getChatCompletionStreamError,
  getChatCompletionTextDelta,
  getCompletedResponse,
  getResponseStreamError,
  getResponseTextDelta,
  parseSseDataLine,
  toTokenUsage,
  validateEmbeddingDimensions,
} from "./openai-response-utils.ts";

export type ChatCompletionContent = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIUsage = TokenUsage & { totalTokens?: number };

export type ChatResponse = {
  message: string;
  usage?: OpenAIUsage;
  model?: string;
  platform?: AIModelConfig["platform"];
  costUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
};

export type EmbeddingResponse = {
  embeddings: number[][];
  usage?: OpenAIUsage;
  model?: string;
  costUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
};

export type ChatRequestOptions = {
  maxOutputTokens?: number;
  reasoningEffort?: string;
  timeoutMs?: number;
  useCase?: AIUseCase;
  aiSettings?: UserAISettings;
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_HTTP_REFERER =
  Deno.env.get("OPENROUTER_HTTP_REFERER")?.trim() || "https://smart-learning-notes.local";
const OPENROUTER_APP_TITLE =
  Deno.env.get("OPENROUTER_APP_TITLE")?.trim() || "Smart Learning Notes";
const OPENAI_EMBED_DIMENSIONS_RAW = Deno.env.get("OPENAI_EMBED_DIMENSIONS")?.trim();
const OPENAI_EMBED_DIMENSIONS = Number(OPENAI_EMBED_DIMENSIONS_RAW || "1536");
const OPENAI_CHAT_TIMEOUT_MS = Number(Deno.env.get("OPENAI_CHAT_TIMEOUT_MS") || "120000");
const OPENAI_EMBED_TIMEOUT_MS = Number(Deno.env.get("OPENAI_EMBED_TIMEOUT_MS") || "90000");
const OPENROUTER_PROVIDER_PREFERENCES = { sort: "throughput" };

export const requireOpenAIKey = () => {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for OpenAI calls.");
  }
  return OPENAI_API_KEY;
};

const requireProviderKey = (
  config: AIModelConfig,
  settings?: UserAISettings,
) => {
  if (config.platform === "openrouter") {
    const key = settings?.providerKeys.openrouter ?? OPENROUTER_API_KEY;
    if (!key) {
      throw new Error("Missing OpenRouter API key. Add one in Settings or set OPENROUTER_API_KEY.");
    }
    return key;
  }

  const key = settings?.providerKeys.openai ?? OPENAI_API_KEY;
  if (!key) {
    throw new Error("Missing OpenAI API key. Add one in Settings or set OPENAI_API_KEY.");
  }
  return key;
};

const getProviderUrl = (
  platform: AIModelConfig["platform"],
  endpoint: "responses" | "chat/completions" | "embeddings",
) => {
  const baseUrl =
    platform === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : "https://api.openai.com/v1";
  return `${baseUrl}/${endpoint}`;
};

const getProviderHeaders = (config: AIModelConfig, apiKey: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (config.platform === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
    headers["X-OpenRouter-Title"] = OPENROUTER_APP_TITLE;
  }
  return headers;
};

const resolveRequestConfig = (
  useCase: AIUseCase,
  options: ChatRequestOptions = {},
) =>
  resolveAIModelConfig(options.aiSettings, useCase, {
    reasoningEffort: options.reasoningEffort as AIModelConfig["reasoningEffort"],
  });

export const resolveAIProviderRequest = (
  useCase: AIUseCase,
  aiSettings?: UserAISettings,
  overrides: Partial<AIModelConfig> = {},
) => {
  const config = resolveAIModelConfig(aiSettings, useCase, overrides);
  const apiKey = requireProviderKey(config, aiSettings);
  return {
    config,
    apiKey,
    headers: getProviderHeaders(config, apiKey),
    url: (endpoint: "responses" | "chat/completions" | "embeddings") =>
      getProviderUrl(config.platform, endpoint),
  };
};

export const stripCodeFences = (text: string) => {
  const fenceMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
};

export const sanitizeForDatabase = (text: string): string => {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
};

export const truncateToTokenLimit = (text: string, maxTokens: number) => {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastParagraph = truncated.lastIndexOf("\n\n");
  const lastSentence = truncated.lastIndexOf(". ");
  const cutPoint = Math.max(lastParagraph, lastSentence, maxChars - 500);

  return (
    truncated.slice(0, cutPoint) +
    "\n\n[... Content truncated for length. Key information above covers the main topics ...]"
  );
};

export const chunkText = (text: string, maxChars = 48000, overlap = 1000) => {
  if (text.length <= maxChars) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const sliceEnd = Math.min(start + maxChars, text.length);
    let chunk = text.slice(start, sliceEnd);

    if (sliceEnd < text.length) {
      const lastBreak = chunk.lastIndexOf("\n\n");
      if (lastBreak > maxChars * 0.6) {
        chunk = chunk.slice(0, lastBreak);
      }
    }

    const trimmed = chunk.trim();
    if (trimmed) chunks.push(trimmed);

    const advanceBy =
      chunk.length > overlap ? chunk.length - overlap : chunk.length;
    if (advanceBy <= 0) break;
    start += advanceBy;
  }

  return chunks;
};

const toUsage = (data: any): OpenAIUsage | undefined => toTokenUsage(data);

const toResponseContent = (content: ChatCompletionContent[]) =>
  content.map((part) => {
    if (part.type === "image_url") {
      return {
        type: "input_image",
        image_url: part.image_url?.url ?? "",
      };
    }
    return {
      type: "input_text",
      text: part.text ?? "",
    };
  });

const toResponseMessages = (messages: ChatMessage[]) =>
  messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
    }));

const toChatCompletionContent = (content: ChatCompletionContent[]) =>
  content.length === 1 && content[0]?.type === "text"
    ? String(content[0].text ?? "")
    : content.map((part) => {
        if (part.type === "image_url") {
          return {
            type: "image_url",
            image_url: part.image_url ?? { url: "" },
          };
        }
        return {
          type: "text",
          text: part.text ?? "",
        };
      });

const toChatCompletionMessages = (messages: ChatMessage[]) =>
  messages.map((message) => ({
    role: message.role,
    content: String(message.content ?? ""),
  }));

const toInstructions = (messages: ChatMessage[]) => {
  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => String(message.content ?? "").trim())
    .filter(Boolean);
  return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
};

const assertResponseSucceeded = (data: any) => {
  if (data?.status === "failed") {
    throw new Error(data?.error?.message ?? "OpenAI response failed");
  }
  if (data?.status === "incomplete") {
    const reason = data?.incomplete_details?.reason ?? "unknown";
    throw new Error(`OpenAI response incomplete: ${reason}`);
  }
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const callChat = async (
  content: ChatCompletionContent[],
  options: ChatRequestOptions = {},
): Promise<ChatResponse> => {
  const config = resolveRequestConfig(options.useCase ?? "lecture_metadata", options);
  const apiKey = requireProviderKey(config, options.aiSettings);
  if (config.platform === "openrouter") {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [{ role: "user", content: toChatCompletionContent(content) }],
      provider: OPENROUTER_PROVIDER_PREFERENCES,
    };
    if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
    if (options.maxOutputTokens) body.max_tokens = options.maxOutputTokens;
    const response = await fetchWithTimeout(getProviderUrl(config.platform, "chat/completions"), {
      method: "POST",
      headers: getProviderHeaders(config, apiKey),
      body: JSON.stringify(body),
    }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat request`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${config.platform} request failed: ${message}`);
    }

    const data = await response.json();
    const usage = toUsage(data);
    const pricing = calculateTokenCostUSD(data?.model ?? config.model, usage ?? {});

    return {
      message: extractChatCompletionText(data),
      usage,
      model: data?.model ?? config.model,
      platform: config.platform,
      costUsd: pricing.totalCost,
      inputCostUsd: pricing.inputCost,
      outputCostUsd: pricing.outputCost,
    };
  }

  const body: Record<string, unknown> = {
    model: config.model,
    input: [{ role: "user", content: toResponseContent(content) }],
    store: false,
  };
  if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
  if (options.maxOutputTokens) body.max_output_tokens = options.maxOutputTokens;
  const response = await fetchWithTimeout(getProviderUrl(config.platform, "responses"), {
    method: "POST",
    headers: getProviderHeaders(config, apiKey),
    body: JSON.stringify(body),
  }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat request`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${config.platform} request failed: ${message}`);
  }

  const data = await response.json();
  assertResponseSucceeded(data);
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? config.model, usage ?? {});

  return {
    message: extractResponseText(data),
    usage,
    model: data?.model ?? config.model,
    platform: config.platform,
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };
};

export const callChatWithMessages = async (
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<ChatResponse> => {
  const config = resolveRequestConfig(options.useCase ?? "tutor_chat", options);
  const apiKey = requireProviderKey(config, options.aiSettings);
  if (config.platform === "openrouter") {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toChatCompletionMessages(messages),
      provider: OPENROUTER_PROVIDER_PREFERENCES,
    };
    if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
    const response = await fetchWithTimeout(getProviderUrl(config.platform, "chat/completions"), {
      method: "POST",
      headers: getProviderHeaders(config, apiKey),
      body: JSON.stringify(body),
    }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat request`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${config.platform} request failed: ${message}`);
    }

    const data = await response.json();
    const usage = toUsage(data);
    const pricing = calculateTokenCostUSD(data?.model ?? config.model, usage ?? {});

    return {
      message: extractChatCompletionText(data),
      usage,
      model: data?.model ?? config.model,
      platform: config.platform,
      costUsd: pricing.totalCost,
      inputCostUsd: pricing.inputCost,
      outputCostUsd: pricing.outputCost,
    };
  }

  const body: Record<string, unknown> = {
    model: config.model,
    input: toResponseMessages(messages),
    instructions: toInstructions(messages),
    store: false,
  };
  if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
  const response = await fetchWithTimeout(getProviderUrl(config.platform, "responses"), {
    method: "POST",
    headers: getProviderHeaders(config, apiKey),
    body: JSON.stringify(body),
  }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat request`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${config.platform} request failed: ${message}`);
  }

  const data = await response.json();
  assertResponseSucceeded(data);
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? config.model, usage ?? {});

  return {
    message: extractResponseText(data),
    usage,
    model: data?.model ?? config.model,
    platform: config.platform,
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };
};

export type StreamChatCallbacks = {
  onChunk: (chunk: string, fullText: string) => void | Promise<void>;
  onDone?: (response: ChatResponse) => void | Promise<void>;
};

/**
 * Stream Responses API text deltas from OpenAI with token callbacks.
 * Returns the final ChatResponse once streaming is complete.
 */
export const callChatWithMessagesStream = async (
  messages: ChatMessage[],
  callbacks: StreamChatCallbacks,
  options: ChatRequestOptions = {},
): Promise<ChatResponse> => {
  const config = resolveRequestConfig(options.useCase ?? "tutor_chat", options);
  const apiKey = requireProviderKey(config, options.aiSettings);
  if (config.platform === "openrouter") {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toChatCompletionMessages(messages),
      provider: OPENROUTER_PROVIDER_PREFERENCES,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
    const response = await fetchWithTimeout(getProviderUrl(config.platform, "chat/completions"), {
      method: "POST",
      headers: getProviderHeaders(config, apiKey),
      body: JSON.stringify(body),
    }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat stream`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${config.platform} request failed: ${message}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body for streaming");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let usage: OpenAIUsage | undefined;
    let modelUsed = config.model;
    let buffer = "";
    let streamError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = parseSseDataLine(trimmed);
          if (!json) continue;

          streamError = getChatCompletionStreamError(json);
          if (streamError) break;

          modelUsed = json?.model ?? modelUsed;
          usage = toUsage(json) ?? usage;

          const delta = getChatCompletionTextDelta(json);
          if (delta) {
            fullText += delta;
            await callbacks.onChunk(delta, fullText);
          }
        } catch {
          // Ignore parse errors for partial lines
        }
      }

      if (streamError) break;
    }

    if (streamError) {
      throw new Error(streamError);
    }

    const pricing = calculateTokenCostUSD(modelUsed, usage ?? {});
    const result: ChatResponse = {
      message: fullText,
      usage,
      model: modelUsed,
      platform: config.platform,
      costUsd: pricing.totalCost,
      inputCostUsd: pricing.inputCost,
      outputCostUsd: pricing.outputCost,
    };

    await callbacks.onDone?.(result);
    return result;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    input: toResponseMessages(messages),
    instructions: toInstructions(messages),
    store: false,
    stream: true,
  };
  if (config.reasoningEffort) body.reasoning = { effort: config.reasoningEffort };
  const response = await fetchWithTimeout(getProviderUrl(config.platform, "responses"), {
    method: "POST",
    headers: getProviderHeaders(config, apiKey),
    body: JSON.stringify(body),
  }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, `${config.platform} chat stream`);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${config.platform} request failed: ${message}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body for streaming");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let usage: OpenAIUsage | undefined;
  let modelUsed = config.model;
  let buffer = "";
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const json = parseSseDataLine(trimmed);
        if (!json) continue;

        streamError = getResponseStreamError(json);
        if (streamError) break;

        const delta = getResponseTextDelta(json);
        if (delta) {
          fullText += delta;
          await callbacks.onChunk(delta, fullText);
        }

        const completed = getCompletedResponse(json);
        if (completed) {
          modelUsed = completed.model ?? modelUsed;
          usage = toUsage(completed);
        }
      } catch {
        // Ignore parse errors for partial lines
      }
    }

    if (streamError) break;
  }

  if (streamError) {
    throw new Error(streamError);
  }

  const pricing = calculateTokenCostUSD(modelUsed, usage ?? {});
  const result: ChatResponse = {
    message: fullText,
    usage,
    model: modelUsed,
    platform: config.platform,
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };

  await callbacks.onDone?.(result);
  return result;
};

export const embedTexts = async (
  inputs: string[],
  options: { useCase?: AIUseCase; aiSettings?: UserAISettings; timeoutMs?: number } = {},
): Promise<EmbeddingResponse> => {
  const config = resolveAIModelConfig(options.aiSettings, options.useCase ?? "embeddings");
  const apiKey = requireProviderKey(config, options.aiSettings);
  const model = config.model;
  const dimensions = Number.isFinite(OPENAI_EMBED_DIMENSIONS) ? OPENAI_EMBED_DIMENSIONS : undefined;
  const results: number[][] = [];
  const batchSize = 12;
  let aggregatedUsage: OpenAIUsage | undefined;

  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize);
    const response = await fetchWithTimeout(getProviderUrl(config.platform, "embeddings"), {
      method: "POST",
      headers: getProviderHeaders(config, apiKey),
      body: JSON.stringify(buildEmbeddingRequestBody(model, slice, dimensions)),
    }, options.timeoutMs ?? OPENAI_EMBED_TIMEOUT_MS, `${config.platform} embeddings request`);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`${config.platform} embeddings failed: ${message}`);
    }

    const data = await response.json();
    const usage = toUsage(data);
    if (usage) {
      aggregatedUsage = {
        promptTokens: (aggregatedUsage?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
        completionTokens: (aggregatedUsage?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
        totalTokens: (aggregatedUsage?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      };
    }

    const embeddings = (data?.data ?? []).map(
      (item: any) => item.embedding as number[]
    );
    validateEmbeddingDimensions(embeddings, dimensions);
    results.push(...embeddings);
  }

  const pricing = calculateTokenCostUSD(model, aggregatedUsage ?? {});

  return {
    embeddings: results,
    usage: aggregatedUsage,
    model,
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };
};
