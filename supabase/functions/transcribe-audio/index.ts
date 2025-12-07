import { corsHeaders } from "../_shared/cors.ts";
import { requireOpenAIKey } from "../_shared/openai.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({ error: "multipart/form-data with file is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const language = (formData.get("language") ?? "en").toString();

    if (!(file instanceof File)) {
      return new Response(
        JSON.stringify({ error: "file is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const buffer = await file.arrayBuffer();
    const outboundFile = new File([buffer], file.name || "audio.m4a", {
      type: file.type || "audio/m4a",
    });

    const openAIForm = new FormData();
    openAIForm.append("file", outboundFile);
    openAIForm.append("model", "whisper-1");
    openAIForm.append("language", language);

    const apiKey = requireOpenAIKey();

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: openAIForm,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Whisper transcription failed: ${message}`);
    }

    const data = await response.json();
    return new Response(
      JSON.stringify({ text: data.text || "" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[transcribe-audio] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to transcribe audio" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

