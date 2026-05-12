import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadUserAISettings } from "../_shared/ai-settings.ts";
import { resolveAIProviderRequest } from "../_shared/openai.ts";

// Rate limiting: max 4096 chars per request (OpenAI TTS limit)
const MAX_INPUT_LENGTH = 4096;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

// Supported voices for OpenAI TTS
type TTSVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "fable"
  | "nova"
  | "onyx"
  | "sage"
  | "shimmer"
  | "verse"
  | "marin"
  | "cedar";

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

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
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

    let userId: string | null = null;
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const authHeader = req.headers.get("Authorization");
      const authClient = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY,
        {
          global: { fetch, headers: authHeader ? { Authorization: authHeader } : {} },
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data } = await authClient.auth.getUser();
      userId = data?.user?.id ?? null;
      const aiSettings = await loadUserAISettings(adminClient, userId);
      const provider = resolveAIProviderRequest("tts", aiSettings);

      // Select voice based on language or use requested voice
      const voice: TTSVoice = requestedVoice || languageVoiceMap[language] || languageVoiceMap.default;

      const response = await fetch(
        provider.config.platform === "openrouter"
          ? "https://openrouter.ai/api/v1/audio/speech"
          : "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: provider.headers,
          body: JSON.stringify({
            model: provider.config.model,
            input: text,
            voice,
            instructions: "Speak naturally and clearly for an educational tutoring app.",
            response_format: "mp3",
            speed: 1.0,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[stream-tts] provider error:", errorText);
        throw new Error(`${provider.config.platform} TTS failed: ${errorText}`);
      }

      // Stream the audio response directly to client
      const audioHeaders = {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      };

      return new Response(response.body, {
        status: 200,
        headers: audioHeaders,
      });
    }

    throw new Error("Missing Supabase service configuration.");
  } catch (error) {
    console.error("[stream-tts] Error:", error);
    const message = getErrorMessage(error, "Failed to generate speech");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
