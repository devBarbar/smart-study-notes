import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  callChat,
  callChatWithMessages,
  chunkText,
  embedTexts,
  requireOpenAIKey,
  sanitizeForDatabase,
  stripCodeFences,
  truncateToTokenLimit,
} from "../_shared/openai.ts";
import {
  feynmanSystemPrompt,
  gradingPrompt,
  lectureMetadataPrompt,
  studyPlanPrompt,
} from "../_shared/prompts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type Job = {
  id: string;
  type: string;
  payload: any;
  user_id: string | null;
};

const noJobResponse = () =>
  new Response(JSON.stringify({ message: "no pending jobs" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const decodeDataUrl = (dataUrl: string): Uint8Array => {
  const matches = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!matches) throw new Error("Invalid data URL");
  const base64 = matches[2];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const handlePlan = async (payload: any) => {
  const { extractedTexts = [], language = "en", options = {} } = payload ?? {};

  const examContentRaw = (extractedTexts ?? [])
    .filter((item: any) => item.isExam)
    .map((item: any) => `=== ${item.fileName} (Past Exam) ===\n${item.text}`)
    .join("\n\n");

  const examContent = examContentRaw ? truncateToTokenLimit(examContentRaw, 6000) : "";

  const combinedContent = (extractedTexts ?? [])
    .map((item: any) =>
      `=== ${item.fileName}${item.isExam ? " (Past Exam)" : ""} ===\n${item.text}`,
    )
    .join("\n\n");

  const chunks = chunkText(combinedContent);
  const allEntries: any[] = [];
  const seenTitles = new Set<string>();
  const passingScoreNote = options.thresholds
    ? `Target readiness: pass at ${options.thresholds.pass}% confidence, solid at ${options.thresholds.good}%, ace at ${options.thresholds.ace}%.`
    : "Target: confidently exceed the passing threshold before adding stretch goals.";

  const tierOrder: Record<string, number> = { core: 0, "high-yield": 1, stretch: 2 };
  const defaultPriority: Record<string, number> = { core: 90, "high-yield": 70, stretch: 40 };

  const normalizeTier = (value: any): string => {
    const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
    if (normalized === "core") return "core";
    if (normalized === "high-yield" || normalized === "high yield") return "high-yield";
    if (normalized === "stretch") return "stretch";
    return "core";
  };

  const normalizePriority = (value: any, tier: string): number => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(100, Math.round(numeric)));
    }
    return defaultPriority[tier];
  };

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const prompt = studyPlanPrompt(chunk, language, {
      chunkInfo:
        chunks.length > 1 ? { chunkNumber: chunkIndex + 1, totalChunks: chunks.length } : undefined,
      examContent: examContent || undefined,
      passingScoreNote,
      additionalNotes: options.additionalNotes,
    });

    const output = await callChat([{ type: "text", text: prompt }]);

    let parsed: any[] | null = null;

    try {
      const clean = stripCodeFences(output);
      const json = JSON.parse(clean);
      if (!Array.isArray(json)) throw new Error("Expected array response");
      parsed = json;
    } catch (error) {
      console.warn("[process-job] Failed to parse study plan chunk:", error);
      parsed = [
        {
          title: "General Study",
          description: "Review all materials comprehensively",
          keyConcepts: ["Review", "Practice", "Understand"],
          category: "General",
          importanceTier: "core",
          priorityScore: defaultPriority.core,
        },
      ];
    }

    parsed.forEach((item: any) => {
      const title = (item.title || "").trim() || `Topic ${allEntries.length + 1}`;
      const normalizedTitle = title.toLowerCase();
      if (seenTitles.has(normalizedTitle)) return;
      seenTitles.add(normalizedTitle);

      const importanceTier = normalizeTier(item.importanceTier);
      const priorityScore = normalizePriority(item.priorityScore, importanceTier);
      const category = (item.category || "").toString().trim() || "General";

      allEntries.push({
        title: sanitizeForDatabase(title),
        description: sanitizeForDatabase(item.description || ""),
        keyConcepts: Array.isArray(item.keyConcepts) ? item.keyConcepts : [],
        category,
        importanceTier,
        priorityScore,
        orderIndex: allEntries.length,
      });
    });
  }

  const entries =
    allEntries.length === 0
      ? [
          {
            title: "General Study",
            description: "Review all materials comprehensively",
            keyConcepts: ["Review", "Practice", "Understand"],
            category: "General",
            importanceTier: "core",
            priorityScore: 90,
            orderIndex: 0,
          },
        ]
      : allEntries
          .map((entry, originalIndex) => ({ ...entry, originalIndex }))
          .sort((a, b) => {
            const tierDelta =
              tierOrder[a.importanceTier ?? "core"] - tierOrder[b.importanceTier ?? "core"];
            if (tierDelta !== 0) return tierDelta;
            const priorityDelta = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
            if (priorityDelta !== 0) return priorityDelta;
            return (a as any).originalIndex - (b as any).originalIndex;
          })
          .map((entry, idx) => {
            const { originalIndex, ...rest } = entry as any;
            return { ...rest, orderIndex: idx };
          });

  return { entries };
};

const handleMetadata = async (payload: any) => {
  const { files = [], language = "en" } = payload ?? {};
  const summary = (files as Array<{ name: string; notes?: string }>)
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

  return { title: parsedTitle, description: parsedDescription };
};

const handleChat = async (payload: any) => {
  const { messages = [], materialContext = "", language = "en" } = payload ?? {};
  const truncatedContext = truncateToTokenLimit(materialContext ?? "", 500000);
  const systemPrompt = feynmanSystemPrompt(truncatedContext, language);
  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...(messages as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role,
      content: String(m.content ?? ""),
    })),
  ];

  const reply = await callChatWithMessages(fullMessages as any);
  return { message: reply };
};

const handleGrade = async (payload: any) => {
  const { question, answerText, answerImageDataUrl, language = "en" } = payload ?? {};
  if (!question || !question.prompt) {
    throw new Error("question.prompt is required");
  }

  const content: any[] = [
    { type: "text", text: gradingPrompt(question, answerText, language) },
  ];

  if (answerText) {
    content.push({ type: "text", text: `Student answer:\n${answerText}` });
  }

  if (answerImageDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: String(answerImageDataUrl) },
    });
  }

  const output = await callChat(content);

  let feedback: any = null;
  try {
    feedback = JSON.parse(output);
  } catch {
    feedback = {
      summary: output,
      correctness: "unknown",
    };
  }

  return {
    feedback: {
      summary: feedback.summary ?? "No summary",
      correctness: feedback.correctness ?? "unknown",
      score: feedback.score ?? undefined,
      improvements: Array.isArray(feedback.improvements) ? feedback.improvements : [],
    },
  };
};

const handleEmbed = async (payload: any) => {
  const { inputs } = payload ?? {};
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("inputs must be a non-empty array");
  }
  const embeddings = await embedTexts(inputs.map((i: any) => String(i)));
  return { embeddings };
};

const handleTranscribe = async (payload: any) => {
  const { audioUrl, language = "en" } = payload ?? {};
  if (!audioUrl) {
    throw new Error("audioUrl is required");
  }

  const apiKey = requireOpenAIKey();
  let file: File;

  if (String(audioUrl).startsWith("data:")) {
    const bytes = decodeDataUrl(String(audioUrl));
    file = new File([bytes], "audio.m4a", { type: "audio/m4a" });
  } else {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    file = new File([arrayBuffer], "audio.m4a", { type: response.headers.get("content-type") ?? "audio/m4a" });
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", "whisper-1");
  formData.append("language", language);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Whisper transcription failed: ${message}`);
  }

  const data = await response.json();
  return { text: data.text || "" };
};

const runJob = async (job: Job) => {
  switch (job.type) {
    case "plan":
      return await handlePlan(job.payload);
    case "metadata":
      return await handleMetadata(job.payload);
    case "chat":
      return await handleChat(job.payload);
    case "grade":
      return await handleGrade(job.payload);
    case "transcribe":
      return await handleTranscribe(job.payload);
    case "embed":
      return await handleEmbed(job.payload);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
};

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase service configuration." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Use service role key to bypass RLS - this is a background job processor
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Pick oldest pending job
    console.log("[process-job] Looking for pending jobs...");
    const { data: pending, error: fetchError } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("[process-job] fetch error", fetchError);
      throw fetchError;
    }

    console.log("[process-job] Found pending job:", pending?.id ?? "none");

    if (!pending) {
      return noJobResponse();
    }

    // Try to lock by setting to running
    const { data: locked, error: lockError } = await supabase
      .from("jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("status", "pending")
      .select("*")
      .single();

    if (lockError) {
      console.error("[process-job] lock error", lockError);
      throw lockError;
    }

    if (!locked) {
      console.log("[process-job] Could not lock job (already taken)");
      return noJobResponse();
    }

    console.log("[process-job] Processing job:", locked.id, "type:", locked.type);
    let result: any = null;

    try {
      result = await runJob(locked as Job);
      console.log("[process-job] Job completed successfully:", locked.id);
      const { error: updateError } = await supabase
        .from("jobs")
        .update({
          status: "succeeded",
          result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", locked.id);

      if (updateError) {
        console.error("[process-job] update success error", updateError);
        throw updateError;
      }
    } catch (jobError: any) {
      console.error("[process-job] job failed", jobError);
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error: jobError?.message?.slice(0, 500) ?? "Job failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", locked.id);
      return new Response(
        JSON.stringify({ error: jobError?.message || "Job failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ message: "job processed", id: locked.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[process-job] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to process job" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

