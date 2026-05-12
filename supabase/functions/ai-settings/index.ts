import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withSentry } from "../_shared/sentry.ts";
import {
  encryptProviderKey,
  loadUserAISettings,
  sanitizeModelConfigMap,
  toPublicAISettings,
  UserAISettings,
} from "../_shared/ai-settings.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const normalizeKeyPatch = (value: unknown) => {
  if (value === undefined) return undefined;
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
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

Deno.serve(withSentry("ai-settings", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase service configuration." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
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

    const { data: userResult, error: userError } = await authClient.auth.getUser();
    if (userError || !userResult?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "get").toLowerCase();
    const userId = userResult.user.id;

    if (action === "get") {
      const settings = await loadUserAISettings(adminClient, userId);
      return new Response(JSON.stringify(toPublicAISettings(settings)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action !== "update") {
      return new Response(
        JSON.stringify({ error: "Unsupported ai-settings action." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const existing = await loadUserAISettings(adminClient, userId);
    const modelConfigPatch = sanitizeModelConfigMap(body?.modelConfig);
    const nextSettings: UserAISettings = {
      modelConfig: {
        ...existing.modelConfig,
        ...modelConfigPatch,
      },
      providerKeys: existing.providerKeys,
    };

    const updatePayload: Record<string, unknown> = {
      user_id: userId,
      model_config: nextSettings.modelConfig,
      updated_at: new Date().toISOString(),
    };

    const openAIKeyPatch = normalizeKeyPatch(body?.apiKeys?.openai);
    if (openAIKeyPatch !== undefined) {
      updatePayload.openai_api_key_ciphertext = openAIKeyPatch
        ? await encryptProviderKey(openAIKeyPatch)
        : null;
    }

    const openRouterKeyPatch = normalizeKeyPatch(body?.apiKeys?.openrouter);
    if (openRouterKeyPatch !== undefined) {
      updatePayload.openrouter_api_key_ciphertext = openRouterKeyPatch
        ? await encryptProviderKey(openRouterKeyPatch)
        : null;
    }

    const { error: upsertError } = await adminClient
      .from("user_ai_settings")
      .upsert(updatePayload, { onConflict: "user_id" });
    if (upsertError) throw upsertError;

    const saved = await loadUserAISettings(adminClient, userId);
    return new Response(JSON.stringify(toPublicAISettings(saved)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ai-settings] Error:", error);
    const message = getErrorMessage(error, "Failed to update AI settings");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
