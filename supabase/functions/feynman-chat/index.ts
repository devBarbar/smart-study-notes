import { corsHeaders } from "../_shared/cors.ts";
import {
  callChatWithMessages,
  ChatMessage,
  truncateToTokenLimit,
} from "../_shared/openai.ts";
import { feynmanSystemPrompt } from "../_shared/prompts.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      messages = [],
      materialContext = "",
      language = "en",
    }: { messages?: ChatMessage[]; materialContext?: string; language?: string } =
      await req.json();

    if (!Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "messages must be an array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const truncatedContext = truncateToTokenLimit(materialContext ?? "", 500000);
    const systemPrompt = feynmanSystemPrompt(truncatedContext, language);

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: String(m.content ?? ""),
      })),
    ];

    const reply = await callChatWithMessages(fullMessages);

    return new Response(
      JSON.stringify({ message: reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[feynman-chat] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to run feynman chat" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

