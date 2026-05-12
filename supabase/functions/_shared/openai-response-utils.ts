export type OpenAIUsageShape = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export const toTokenUsage = (data: any): OpenAIUsageShape | undefined => {
  const usage = data?.usage;
  if (!usage) return undefined;

  const promptTokens = usage.input_tokens ?? usage.prompt_tokens;
  const completionTokens = usage.output_tokens ?? usage.completion_tokens;
  const totalTokens = usage.total_tokens;

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

export const extractResponseText = (data: any): string => {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (
        (content?.type === "output_text" || content?.type === "text") &&
        typeof content?.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
};

export const extractChatCompletionText = (data: any): string => {
  const parts: string[] = [];
  for (const choice of data?.choices ?? []) {
    const content = choice?.message?.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (typeof item?.text === "string") {
          parts.push(item.text);
        }
      }
    }
  }
  return parts.join("");
};

export const parseSseDataLine = (line: string): any | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) {
    return null;
  }
  return JSON.parse(trimmed.slice(6));
};

export const getResponseTextDelta = (event: any): string => {
  if (event?.type !== "response.output_text.delta") return "";
  return typeof event.delta === "string" ? event.delta : "";
};

export const getChatCompletionTextDelta = (event: any): string => {
  const content = event?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
};

export const getCompletedResponse = (event: any): any | null => {
  return event?.type === "response.completed" ? event.response ?? null : null;
};

export const getResponseStreamError = (event: any): string | null => {
  if (event?.type === "error") {
    return event?.error?.message ?? event?.message ?? "OpenAI stream failed";
  }
  if (event?.type === "response.incomplete") {
    const reason = event?.response?.incomplete_details?.reason ?? "unknown";
    return `OpenAI response incomplete: ${reason}`;
  }
  if (event?.type === "response.failed") {
    return event?.response?.error?.message ?? "OpenAI response failed";
  }
  return null;
};

export const getChatCompletionStreamError = (event: any): string | null => {
  if (event?.error) {
    return event.error?.message ?? event.message ?? "OpenRouter stream failed";
  }
  const choice = event?.choices?.[0];
  if (choice?.finish_reason === "error") {
    return event?.error?.message ?? choice?.error?.message ?? "OpenRouter stream failed";
  }
  return null;
};

export const buildEmbeddingRequestBody = (
  model: string,
  input: string[],
  dimensions?: number,
) => ({
  model,
  input,
  ...(typeof dimensions === "number" && Number.isFinite(dimensions)
    ? { dimensions }
    : {}),
});

export const validateEmbeddingDimensions = (
  embeddings: number[][],
  expectedDimensions?: number,
) => {
  if (expectedDimensions === undefined) return;

  embeddings.forEach((embedding, index) => {
    if (embedding.length !== expectedDimensions) {
      throw new Error(
        `Embedding ${index} has ${embedding.length} dimensions; expected ${expectedDimensions}.`,
      );
    }
  });
};
