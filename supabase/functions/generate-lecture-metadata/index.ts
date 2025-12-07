import { corsHeaders } from "../_shared/cors.ts";
import { callChat, stripCodeFences } from "../_shared/openai.ts";
import { lectureMetadataPrompt } from "../_shared/prompts.ts";

type FileSummary = { name: string; notes?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { files = [], language = "en" } = await req.json();

    if (!Array.isArray(files)) {
      return new Response(
        JSON.stringify({ error: "files must be an array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const summary = (files as FileSummary[])
      .map((f, idx) => `${idx + 1}. ${f.name}${f.notes ? ` — ${f.notes}` : ""}`)
      .join("\n");

    const prompt = lectureMetadataPrompt(summary || "No details provided.", language);
    const output = await callChat([{ type: "text", text: prompt }]);

    let parsedTitle = "New Lecture";
    let parsedDescription = "";

    try {
      const clean = stripCodeFences(output);
      const parsed = JSON.parse(clean);
      parsedTitle = parsed.title ?? parsedTitle;
      parsedDescription = parsed.description ?? parsedDescription;
    } catch {
      parsedDescription = output;
    }

    return new Response(
      JSON.stringify({ title: parsedTitle, description: parsedDescription }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-lecture-metadata] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to generate lecture metadata" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

