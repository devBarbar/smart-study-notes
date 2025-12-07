import { corsHeaders } from "../_shared/cors.ts";
import {
  callChat,
  chunkText,
  sanitizeForDatabase,
  stripCodeFences,
  truncateToTokenLimit,
} from "../_shared/openai.ts";
import { studyPlanPrompt } from "../_shared/prompts.ts";

type StudyPlanSource = { fileName: string; text: string; isExam?: boolean };
type StudyPlanOptions = {
  additionalNotes?: string;
  thresholds?: { pass: number; good: number; ace: number };
};

type StudyPlanEntry = {
  title: string;
  description?: string;
  keyConcepts: string[];
  category?: string;
  importanceTier: "core" | "high-yield" | "stretch";
  priorityScore: number;
  orderIndex: number;
};

const tierOrder: Record<StudyPlanEntry["importanceTier"], number> = {
  core: 0,
  "high-yield": 1,
  stretch: 2,
};

const defaultPriority: Record<StudyPlanEntry["importanceTier"], number> = {
  core: 90,
  "high-yield": 70,
  stretch: 40,
};

const normalizeTier = (value: any): StudyPlanEntry["importanceTier"] => {
  const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (normalized === "core") return "core";
  if (normalized === "high-yield" || normalized === "high yield") return "high-yield";
  if (normalized === "stretch") return "stretch";
  return "core";
};

const normalizePriority = (value: any, tier: StudyPlanEntry["importanceTier"]): number => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(numeric)));
  }
  return defaultPriority[tier];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      extractedTexts = [],
      language = "en",
      options = {},
    }: { extractedTexts?: StudyPlanSource[]; language?: string; options?: StudyPlanOptions } =
      await req.json();

    if (!Array.isArray(extractedTexts)) {
      return new Response(
        JSON.stringify({ error: "extractedTexts must be an array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const examContentRaw = (extractedTexts ?? [])
      .filter((item) => item.isExam)
      .map((item) => `=== ${item.fileName} (Past Exam) ===\n${item.text}`)
      .join("\n\n");

    const examContent = examContentRaw ? truncateToTokenLimit(examContentRaw, 6000) : "";

    const combinedContent = (extractedTexts ?? [])
      .map((item) =>
        `=== ${item.fileName}${item.isExam ? " (Past Exam)" : ""} ===\n${item.text}`,
      )
      .join("\n\n");

    const chunks = chunkText(combinedContent);
    const allEntries: StudyPlanEntry[] = [];
    const seenTitles = new Set<string>();
    const passingScoreNote = options.thresholds
      ? `Target readiness: pass at ${options.thresholds.pass}% confidence, solid at ${options.thresholds.good}%, ace at ${options.thresholds.ace}%.`
      : "Target: confidently exceed the passing threshold before adding stretch goals.";

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const prompt = studyPlanPrompt(chunk, language, {
        chunkInfo:
          chunks.length > 1
            ? { chunkNumber: chunkIndex + 1, totalChunks: chunks.length }
            : undefined,
        examContent: examContent || undefined,
        passingScoreNote,
        additionalNotes: options.additionalNotes,
      });

      const output = await callChat([{ type: "text", text: prompt }]);

      let parsed: any[] | null = null;

      try {
        const clean = stripCodeFences(output);
        const json = JSON.parse(clean);
        if (!Array.isArray(json)) {
          throw new Error("Expected array response");
        }
        parsed = json;
      } catch (error) {
        console.warn("[generate-study-plan] Failed to parse study plan chunk:", error);
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
              priorityScore: defaultPriority.core,
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

    return new Response(
      JSON.stringify({ entries }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[generate-study-plan] Error:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to generate study plan" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

