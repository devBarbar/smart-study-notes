import { calculateTokenCostUSD, TokenUsage } from "./pricing.ts";

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

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.1";
const OPENAI_EMBED_MODEL =
  Deno.env.get("OPENAI_EMBED_MODEL") ?? "text-embedding-3-small";

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

const toUsage = (data: any): OpenAIUsage | undefined => {
  const promptTokens = data?.usage?.prompt_tokens;
  const completionTokens = data?.usage?.completion_tokens;
  const totalTokens = data?.usage?.total_tokens;
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens: typeof promptTokens === "number" ? promptTokens : undefined,
    completionTokens: typeof completionTokens === "number" ? completionTokens : undefined,
    totalTokens: typeof totalTokens === "number" ? totalTokens : undefined,
  };
};

export const callChat = async (content: ChatCompletionContent[]): Promise<ChatResponse> => {
  const apiKey = requireOpenAIKey();
  const model = OPENAI_MODEL;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? model, usage ?? {});

  return {
    message: data.choices?.[0]?.message?.content as string,
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
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  const usage = toUsage(data);
  const pricing = calculateTokenCostUSD(data?.model ?? model, usage ?? {});

  return {
    message: data.choices?.[0]?.message?.content as string,
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
 * Stream chat completions from OpenAI with delta token callbacks.
 * Returns the final ChatResponse once streaming is complete.
 */
export const callChatWithMessagesStream = async (
  messages: ChatMessage[],
  callbacks: StreamChatCallbacks,
): Promise<ChatResponse> => {
  const apiKey = requireOpenAIKey();
  const model = OPENAI_MODEL;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

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
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          await callbacks.onChunk(delta, fullText);
        }
        if (json.model) {
          modelUsed = json.model;
        }
        if (json.usage) {
          usage = toUsage(json);
        }
      } catch {
        // Ignore parse errors for partial lines
      }
    }
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
  const results: number[][] = [];
  const batchSize = 12;
  let aggregatedUsage: OpenAIUsage | undefined;

  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: slice,
      }),
    });

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

