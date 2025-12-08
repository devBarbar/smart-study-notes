import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const allowedTypes = new Set([
  "plan",
  "chat",
  "grade",
  "transcribe",
  "metadata",
  "embed",
  "practice_exam",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase service configuration." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use caller auth if provided, otherwise fall back to anon key so the gateway isn't missing a token.
    const authHeader =
      req.headers.get("Authorization") ?? `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch, headers: { Authorization: authHeader ?? "" } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { type, payload } = await req.json();

    if (!allowedTypes.has(type)) {
      return new Response(
        JSON.stringify({ error: "Invalid job type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (payload === undefined || payload === null) {
      return new Response(
        JSON.stringify({ error: "payload is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        type,
        payload,
        status: "pending",
        user_id: userResult.user.id,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[enqueue-job] insert error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ jobId: data.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[enqueue-job] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to enqueue job" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

