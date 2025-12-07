export type ChatCompletionContent = {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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

export const chunkText = (text: string, maxChars = 12000, overlap = 500) => {
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

export const callChat = async (content: ChatCompletionContent[]) => {
  const apiKey = requireOpenAIKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content as string;
};

export const callChatWithMessages = async (messages: ChatMessage[]) => {
  const apiKey = requireOpenAIKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content as string;
};

export const embedTexts = async (inputs: string[]): Promise<number[][]> => {
  requireOpenAIKey();
  const results: number[][] = [];
  const batchSize = 12;

  for (let i = 0; i < inputs.length; i += batchSize) {
    const slice = inputs.slice(i, i + batchSize);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: slice,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI embeddings failed: ${message}`);
    }

    const data = await response.json();
    const embeddings = (data?.data ?? []).map(
      (item: any) => item.embedding as number[]
    );
    results.push(...embeddings);
  }

  return results;
};

