import { corsHeaders } from "../_shared/cors.ts";
import { requireOpenAIKey } from "../_shared/openai.ts";

// Rate limiting: max 4096 chars per request (OpenAI TTS limit)
const MAX_INPUT_LENGTH = 4096;

// Supported voices for OpenAI TTS
type TTSVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

// Language to voice mapping for natural sounding speech
const languageVoiceMap: Record<string, TTSVoice> = {
  en: "nova",
  de: "onyx",
  es: "nova",
  fr: "nova",
  it: "nova",
  pt: "nova",
  default: "nova",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { text, language = "en", voice: requestedVoice } = body;

    if (!text || typeof text !== "string") {
      return new Response(
        JSON.stringify({ error: "text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce input length limit
    if (text.length > MAX_INPUT_LENGTH) {
      return new Response(
        JSON.stringify({ 
          error: `Text exceeds maximum length of ${MAX_INPUT_LENGTH} characters`,
          maxLength: MAX_INPUT_LENGTH,
          actualLength: text.length,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip empty or whitespace-only text
    if (!text.trim()) {
      return new Response(
        JSON.stringify({ error: "Text cannot be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = requireOpenAIKey();

    // Select voice based on language or use requested voice
    const voice: TTSVoice = requestedVoice || languageVoiceMap[language] || languageVoiceMap.default;

    // Call OpenAI TTS API with streaming response
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1", // Use tts-1 for lower latency, tts-1-hd for higher quality
        input: text,
        voice,
        response_format: "mp3", // mp3 is widely supported
        speed: 1.0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[stream-tts] OpenAI error:", errorText);
      throw new Error(`OpenAI TTS failed: ${errorText}`);
    }

    // Stream the audio response directly to client
    const audioHeaders = {
      ...corsHeaders,
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    };

    // Return streaming response
    return new Response(response.body, {
      status: 200,
      headers: audioHeaders,
    });
  } catch (error) {
    console.error("[stream-tts] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to generate speech" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

