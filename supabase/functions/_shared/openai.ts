import { calculateTokenCostUSD, TokenUsage } from "./pricing.ts";
import {
  buildEmbeddingRequestBody,
  extractResponseText,
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
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-5.5";
const OPENAI_REASONING_EFFORT = Deno.env.get("OPENAI_REASONING_EFFORT")?.trim() || "high";
const OPENAI_EMBED_MODEL =
  Deno.env.get("OPENAI_EMBED_MODEL")?.trim() || "text-embedding-3-large";
const OPENAI_EMBED_DIMENSIONS_RAW = Deno.env.get("OPENAI_EMBED_DIMENSIONS")?.trim();
const OPENAI_EMBED_DIMENSIONS = Number(OPENAI_EMBED_DIMENSIONS_RAW || "1536");
const OPENAI_CHAT_TIMEOUT_MS = Number(Deno.env.get("OPENAI_CHAT_TIMEOUT_MS") || "120000");
const OPENAI_EMBED_TIMEOUT_MS = Number(Deno.env.get("OPENAI_EMBED_TIMEOUT_MS") || "90000");

export const requireOpenAIKey = () => {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for OpenAI calls.");
  }
  return OPENAI_API_KEY;
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
  const apiKey = requireOpenAIKey();
  const model = OPENAI_MODEL;
  const body: Record<string, unknown> = {
    model,
    input: [{ role: "user", content: toResponseContent(content) }],
    reasoning: { effort: options.reasoningEffort ?? OPENAI_REASONING_EFFORT },
    store: false,
  };
  if (options.maxOutputTokens) body.max_output_tokens = options.maxOutputTokens;
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, options.timeoutMs ?? OPENAI_CHAT_TIMEOUT_MS, "OpenAI chat request");

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  assertResponseSucceeded(data);
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? model, usage ?? {});

  return {
    message: extractResponseText(data),
    usage,
    model: data?.model ?? model,
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };
};

export const callChatWithMessages = async (
  messages: ChatMessage[],
): Promise<ChatResponse> => {
  const apiKey = requireOpenAIKey();
  const model = OPENAI_MODEL;
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: toResponseMessages(messages),
      instructions: toInstructions(messages),
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      store: false,
    }),
  }, OPENAI_CHAT_TIMEOUT_MS, "OpenAI chat request");

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  assertResponseSucceeded(data);
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? model, usage ?? {});

  return {
    message: extractResponseText(data),
    usage,
    model: data?.model ?? model,
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
): Promise<ChatResponse> => {
  const apiKey = requireOpenAIKey();
  const model = OPENAI_MODEL;
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: toResponseMessages(messages),
      instructions: toInstructions(messages),
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      store: false,
      stream: true,
    }),
  }, OPENAI_CHAT_TIMEOUT_MS, "OpenAI chat stream");

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body for streaming");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let usage: OpenAIUsage | undefined;
  let modelUsed = model;
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
    costUsd: pricing.totalCost,
    inputCostUsd: pricing.inputCost,
    outputCostUsd: pricing.outputCost,
  };

  await callbacks.onDone?.(result);
  return result;
};

export const embedTexts = async (inputs: string[]): Promise<EmbeddingResponse> => {
  requireOpenAIKey();
  const model = OPENAI_EMBED_MODEL;
  const dimensions = Number.isFinite(OPENAI_EMBED_DIMENSIONS) ? OPENAI_EMBED_DIMENSIONS : undefined;
  const results: number[][] = [];
  const batchSize = 12;
  let aggregatedUsage: OpenAIUsage | undefined;

  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize);
    const response = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(buildEmbeddingRequestBody(model, slice, dimensions)),
    }, OPENAI_EMBED_TIMEOUT_MS, "OpenAI embeddings request");

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI embeddings failed: ${message}`);
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
