import { corsHeaders } from "../_shared/cors.ts";
import { embedTexts } from "../_shared/openai.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputs } = await req.json();

    if (!Array.isArray(inputs) || inputs.length === 0) {
      return new Response(
        JSON.stringify({ error: "inputs must be a non-empty array of strings" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const embeddings = await embedTexts(inputs.map((item) => String(item)));

    return new Response(
      JSON.stringify({ embeddings }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[embed-texts] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to embed texts" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

