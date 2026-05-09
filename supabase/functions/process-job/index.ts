import { createClient } from "npm:@supabase/supabase-js@2";
import pLimit from "npm:p-limit";
import { getDocumentProxy } from "npm:unpdf";
import { corsHeaders } from "../_shared/cors.ts";
import {
  callChat,
  callChatWithMessages,
  callChatWithMessagesStream,
  chunkText,
  embedTexts,
  requireOpenAIKey,
  sanitizeForDatabase,
  stripCodeFences,
  truncateToTokenLimit,
} from "../_shared/openai.ts";
import { toTokenUsage } from "../_shared/openai-response-utils.ts";
import {
  feynmanSystemPrompt,
  gradingPrompt,
  lectureMetadataPrompt,
  practiceExamPrompt,
  studyPlanPrompt,
} from "../_shared/prompts.ts";
import {
  buildConceptInventoryPrompt,
  buildLearningPathPrompt,
  parseLearningPath,
  ParsedPlanEntry,
  PlanSettings,
} from "../_shared/study-plan-v2.ts";
import { insertUsageLog } from "../_shared/usage.ts";

// EdgeRuntime is available in Supabase Edge Functions for background work
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const OPENAI_TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL")?.trim() || "gpt-4o-transcribe";

type Job = {
  id: string;
  type: string;
  payload: any;
  user_id: string | null;
};

type UsageLogPayload = {
  feature: string;
  model?: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  lectureId?: string | null;
  audioDurationSeconds?: number;
  metadata?: Record<string, unknown>;
};

type JobRunResult = { result: any; usage?: UsageLogPayload };

const noJobResponse = () =>
  new Response(JSON.stringify({ message: "no pending jobs" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const kickProcessJob = (jobId?: string) => {
  if (!SUPABASE_URL) return;
  const token = SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return;

  const request = fetch(`${SUPABASE_URL}/functions/v1/process-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "process-job", jobId }),
  }).catch((error) => console.error("[process-job] follow-up kick failed", error));

  try {
    EdgeRuntime.waitUntil(request);
  } catch {
    return request;
  }
};

const enqueueInternalJob = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
) => {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type, payload, status: "pending", user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  kickProcessJob(data.id);
  return data.id as string;
};

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

type ExtractedPage = { pageNumber: number; text: string };
type LecturePlanFile = {
  id: string;
  name: string;
  uri: string;
  extracted_text?: string | null;
  is_exam?: boolean | null;
};

const hashText = (input: string): string => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
};

const splitTextForEmbeddings = (text: string, maxChars = 1600, overlap = 200): string[] => {
  if (text.length <= maxChars) return text.trim() ? [text.trim()] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const sliceEnd = Math.min(start + maxChars, text.length);
    let chunk = text.slice(start, sliceEnd);
    if (sliceEnd < text.length) {
      const lastBreak = chunk.lastIndexOf("\n\n");
      if (lastBreak > maxChars * 0.6) chunk = chunk.slice(0, lastBreak);
    }
    const trimmed = chunk.trim();
    if (trimmed) chunks.push(trimmed);
    const advanceBy = chunk.length > overlap ? chunk.length - overlap : chunk.length;
    if (advanceBy <= 0) break;
    start += advanceBy;
  }
  return chunks;
};

type PlanMaterialChunk = {
  index: number;
  label: string;
  content: string;
};

const buildLecturePlanMaterialChunks = (
  extractedTexts: { fileName: string; text: string; isExam?: boolean }[],
): PlanMaterialChunk[] => {
  const materialChunks: PlanMaterialChunk[] = [];
  const maxChunkChars = 22000;
  let currentLabels: string[] = [];
  let currentSections: string[] = [];
  let currentLength = 0;

  const flushCurrent = () => {
    if (currentSections.length === 0) return;
    materialChunks.push({
      index: materialChunks.length,
      label: currentLabels.join(", "),
      content: currentSections.join("\n\n"),
    });
    currentLabels = [];
    currentSections = [];
    currentLength = 0;
  };

  extractedTexts.forEach((item) => {
    const chunks = chunkText(item.text || `PDF Document: ${item.fileName}.`, maxChunkChars, 800);
    chunks.forEach((chunk, index) => {
      const label = `${item.fileName}${item.isExam ? " (Past Exam)" : ""}${
        chunks.length > 1 ? ` part ${index + 1}/${chunks.length}` : ""
      }`;
      const section = `=== ${label} ===\n${chunk}`;
      if (currentLength > 0 && currentLength + section.length + 2 > maxChunkChars) {
        flushCurrent();
      }
      currentLabels.push(label);
      currentSections.push(section);
      currentLength += section.length + 2;
    });
  });

  flushCurrent();
  return materialChunks;
};

const extractPdfPages = async (pdfUrl: string): Promise<ExtractedPage[]> => {
  const pdfResponse = await fetch(pdfUrl);
  if (!pdfResponse.ok) throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const pages: ExtractedPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = (textContent.items ?? [])
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");
    const sanitized = sanitizeForDatabase(text);
    if (sanitized) pages.push({ pageNumber, text: sanitized });
  }
  return pages;
};

const aggregateUsage = (
  current: UsageLogPayload | undefined,
  next: Partial<UsageLogPayload>,
): UsageLogPayload => ({
  feature: current?.feature ?? next.feature ?? "lecture_plan_v2",
  model: next.model ?? current?.model ?? null,
  usage: {
    promptTokens: (current?.usage?.promptTokens ?? 0) + (next.usage?.promptTokens ?? 0),
    completionTokens: (current?.usage?.completionTokens ?? 0) + (next.usage?.completionTokens ?? 0),
    totalTokens: (current?.usage?.totalTokens ?? 0) + (next.usage?.totalTokens ?? 0),
  },
  costUsd: (current?.costUsd ?? 0) + (next.costUsd ?? 0),
  inputCostUsd: (current?.inputCostUsd ?? 0) + (next.inputCostUsd ?? 0),
  outputCostUsd: (current?.outputCostUsd ?? 0) + (next.outputCostUsd ?? 0),
  lectureId: next.lectureId ?? current?.lectureId ?? null,
  metadata: { ...(current?.metadata ?? {}), ...(next.metadata ?? {}) },
});

const handlePlan = async (payload: any): Promise<JobRunResult> => {
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
  const passingScoreNote = "Target: confidently exceed the passing threshold (45%) before adding stretch goals. Use the German grading scale (1.0 best, 4.0 minimum pass, below 45% = failed).";

  const tierOrder: Record<string, number> = { core: 0, "high-yield": 1, stretch: 2 };
  const defaultPriority: Record<string, number> = { core: 90, "high-yield": 70, stretch: 40 };
  const planConcurrency = 3;
  const limit = pLimit(planConcurrency);

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

  let aggregatedUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null =
    null;
  let totalInputCost = 0;
  let totalOutputCost = 0;
  let lastModel: string | null = null;

  const chunkResults: Array<{ chunkIndex: number; parsed: any[] }> = await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      limit(async () => {
        console.log(
          `[process-job][plan] Starting chunk ${chunkIndex + 1}/${chunks.length} (len=${chunk.length})`,
        );

        const prompt = studyPlanPrompt(chunk, language, {
          chunkInfo:
            chunks.length > 1
              ? { chunkNumber: chunkIndex + 1, totalChunks: chunks.length }
              : undefined,
          examContent: examContent || undefined,
          passingScoreNote,
          additionalNotes: options.additionalNotes,
        });

        const chat = await callChat([{ type: "text", text: prompt }]);
        console.log(`[process-job][plan] Completed chunk ${chunkIndex + 1}/${chunks.length}`);

        if (chat.usage) {
          aggregatedUsage = {
            promptTokens: (aggregatedUsage?.promptTokens ?? 0) + (chat.usage.promptTokens ?? 0),
            completionTokens:
              (aggregatedUsage?.completionTokens ?? 0) + (chat.usage.completionTokens ?? 0),
            totalTokens: (aggregatedUsage?.totalTokens ?? 0) + (chat.usage.totalTokens ?? 0),
          };
        }
        totalInputCost += chat.inputCostUsd ?? 0;
        totalOutputCost += chat.outputCostUsd ?? 0;
        lastModel = chat.model ?? lastModel;

        let parsed: any[] = [];

        try {
          const clean = stripCodeFences(chat.message);
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

        return { chunkIndex, parsed };
      }),
    ),
  );

  chunkResults
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .forEach(({ parsed }) => {
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
    });

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

  return {
    result: { entries },
    usage: {
      feature: "plan",
      model: lastModel,
      usage: aggregatedUsage ?? undefined,
      inputCostUsd: totalInputCost || undefined,
      outputCostUsd: totalOutputCost || undefined,
      costUsd: (totalInputCost || 0) + (totalOutputCost || 0),
      lectureId: payload?.lectureId ?? payload?.lecture_id ?? null,
      metadata: { chunks: chunks.length },
    },
  };
};

const handleLecturePlanV2 = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
): Promise<JobRunResult> => {
  const { lectureId, regenerate = false } = payload ?? {};
  if (!lectureId) throw new Error("lectureId is required");
  if (!userId) throw new Error("User context required for lecture plan generation");

  let usage: UsageLogPayload | undefined = {
    feature: "lecture_plan_v2",
    lectureId,
    costUsd: 0,
  };
  const warnings: string[] = [];

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id,title,additional_notes,plan_settings")
    .eq("id", lectureId)
    .eq("user_id", userId)
    .single();
  if (lectureError) throw lectureError;
  if (!lecture) throw new Error("Lecture not found");

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("id,name,uri,extracted_text,is_exam")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (filesError) throw filesError;
  if (!files?.length) throw new Error("Lecture has no files");

  const planSettings: PlanSettings = {
    preferredSessionMinutes: 45,
    targetGrade: "pass",
    ...((lecture.plan_settings as PlanSettings | null) ?? {}),
  };
  if (!planSettings.additionalNotes && lecture.additional_notes) {
    planSettings.additionalNotes = lecture.additional_notes;
  }

  await supabase
    .from("lectures")
    .update({ plan_status: "pending", plan_generated_at: null, plan_error: null })
    .eq("id", lectureId);

  const extractedTexts: { fileName: string; text: string; isExam?: boolean }[] = [];

  for (const file of files as LecturePlanFile[]) {
    let pages: ExtractedPage[] = [];
    if (file.extracted_text?.trim()) {
      pages = [{ pageNumber: 1, text: sanitizeForDatabase(file.extracted_text) }];
    } else {
      try {
        pages = await extractPdfPages(file.uri);
        const fullText = pages.map((page) => page.text).join("\n\n");
        await supabase
          .from("lecture_files")
          .update({ extracted_text: fullText })
          .eq("id", file.id)
          .eq("user_id", userId);
      } catch (error: any) {
        warnings.push(`Could not extract ${file.name}: ${error?.message ?? String(error)}`);
      }
    }

    const fullText = pages.map((page) => page.text).join("\n\n");
    extractedTexts.push({
      fileName: file.name,
      text: fullText || `PDF Document: ${file.name}.`,
      isExam: Boolean(file.is_exam),
    });
  }

  if (!extractedTexts.some((item) => item.text && !item.text.startsWith("PDF Document:"))) {
    warnings.push("No PDF text could be extracted; generated from file names.");
  }

  const runId = crypto.randomUUID();
  const materialChunks = buildLecturePlanMaterialChunks(extractedTexts);
  if (materialChunks.length === 0) throw new Error("No lecture text available for AI planning");

  for (const chunk of materialChunks) {
    await enqueueInternalJob(supabase, userId, "lecture_plan_inventory", {
      lectureId,
      runId,
      chunkIndex: chunk.index,
      totalChunks: materialChunks.length,
      label: chunk.label,
      content: chunk.content,
      planSettings,
      language: payload?.language ?? "en",
    });
  }

  return {
    result: {
      inventoryJobsCreated: materialChunks.length,
      warnings,
    },
    usage: {
      ...usage,
      feature: "lecture_plan_v2",
      lectureId,
      metadata: {
        ...(usage?.metadata ?? {}),
        inventoryJobsCreated: materialChunks.length,
        sourceDocuments: extractedTexts.length,
        warnings: warnings.length,
      },
    },
  };
};

const saveLecturePlanFromParsedPath = async (
  supabase: ReturnType<typeof createClient>,
  lectureId: string,
  userId: string,
  parsedPath: ReturnType<typeof parseLearningPath>,
  warnings: string[],
  usage: UsageLogPayload | undefined,
): Promise<JobRunResult> => {
  warnings.push(...parsedPath.warnings);

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("id,name,extracted_text")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (filesError) throw filesError;

  await supabase.from("study_plan_entries").delete().eq("lecture_id", lectureId).eq("user_id", userId);
  await supabase.from("study_plan_modules").delete().eq("lecture_id", lectureId).eq("user_id", userId);
  await supabase.from("lecture_file_chunks").delete().eq("lecture_id", lectureId);

  const moduleIdByClientId = new Map<string, string>();
  const moduleRows = parsedPath.modules.map((module) => {
    const id = crypto.randomUUID();
    moduleIdByClientId.set(module.clientId, id);
    return {
      id,
      lecture_id: lectureId,
      user_id: userId,
      title: module.title,
      summary: module.summary ?? null,
      order_index: module.orderIndex,
      estimated_minutes: module.estimatedMinutes ?? null,
    };
  });

  const { error: moduleInsertError } = await supabase.from("study_plan_modules").insert(moduleRows);
  if (moduleInsertError) throw moduleInsertError;

  const entryIdByClientId = new Map<string, string>();
  parsedPath.entries.forEach((entry) => entryIdByClientId.set(entry.clientId, crypto.randomUUID()));

  const entryRows = parsedPath.entries.map((entry: ParsedPlanEntry) => {
    const moduleId = moduleIdByClientId.get(entry.moduleClientId) ?? moduleRows[0]?.id ?? null;
    const prerequisiteEntryIds = entry.prerequisiteClientIds
      .map((id) => entryIdByClientId.get(id))
      .filter((id): id is string => Boolean(id));
    return {
      id: entryIdByClientId.get(entry.clientId),
      lecture_id: lectureId,
      user_id: userId,
      module_id: moduleId,
      title: entry.title,
      description: entry.description ?? null,
      key_concepts: entry.keyConcepts ?? [],
      order_index: entry.orderIndex,
      category: entry.category ?? null,
      importance_tier: entry.importanceTier ?? "core",
      priority_score: entry.priorityScore ?? 0,
      status: "not_started",
      from_exam_source: entry.fromExamSource ?? false,
      exam_relevance: entry.examRelevance ?? null,
      mentioned_in_notes: entry.mentionedInNotes ?? false,
      prerequisite_entry_ids: prerequisiteEntryIds,
      learning_objective: entry.learningObjective ?? null,
      estimated_minutes: entry.estimatedMinutes ?? null,
      difficulty: entry.difficulty ?? null,
      sequence_reason: entry.sequenceReason ?? null,
      source_refs: entry.sourceRefs ?? null,
    };
  });

  const { error: entryInsertError } = await supabase.from("study_plan_entries").insert(entryRows);
  if (entryInsertError) throw entryInsertError;

  const chunkRows: any[] = [];
  for (const file of files ?? []) {
    const text = sanitizeForDatabase(String((file as any).extracted_text ?? ""));
    splitTextForEmbeddings(text).forEach((content, chunkIndex) => {
      chunkRows.push({
        lecture_id: lectureId,
        lecture_file_id: (file as any).id,
        page_number: 1,
        chunk_index: chunkIndex,
        content,
        content_hash: hashText(`${(file as any).id}:1:${chunkIndex}:${content}`),
      });
    });
  }

  if (chunkRows.length > 0) {
    const embeddingResult = await embedTexts(chunkRows.map((chunk) => chunk.content));
    usage = aggregateUsage(usage, {
      feature: "lecture_plan_v2",
      model: embeddingResult.model,
      usage: embeddingResult.usage,
      costUsd: embeddingResult.costUsd,
      inputCostUsd: embeddingResult.inputCostUsd,
      outputCostUsd: embeddingResult.outputCostUsd,
      lectureId,
      metadata: { chunks: chunkRows.length },
    });
    const rowsWithEmbeddings = chunkRows.map((chunk, idx) => ({
      ...chunk,
      embedding: embeddingResult.embeddings[idx],
    }));
    const { error: chunkInsertError } = await supabase
      .from("lecture_file_chunks")
      .upsert(rowsWithEmbeddings, { onConflict: "content_hash" });
    if (chunkInsertError) warnings.push(`Embedding index failed: ${chunkInsertError.message}`);
  }

  await supabase
    .from("lectures")
    .update({
      plan_status: "ready",
      plan_generated_at: new Date().toISOString(),
      plan_error: warnings.length > 0 ? warnings.join(" | ").slice(0, 500) : null,
    })
    .eq("id", lectureId)
    .eq("user_id", userId);

  return {
    result: {
      modulesCreated: moduleRows.length,
      entriesCreated: entryRows.length,
      warnings,
    },
    usage: {
      ...usage,
      feature: "lecture_plan_v2",
      lectureId,
      metadata: {
        ...(usage?.metadata ?? {}),
        modules: moduleRows.length,
        entries: entryRows.length,
        warnings: warnings.length,
      },
    },
  };
};

const handleLecturePlanInventory = async (
  payload: any,
  _supabase: ReturnType<typeof createClient>,
  userId: string | null,
): Promise<JobRunResult> => {
  const {
    lectureId,
    chunkIndex,
    totalChunks,
    label,
    content,
    planSettings,
    language = "en",
  } = payload ?? {};
  if (!lectureId || typeof content !== "string") {
    throw new Error("lectureId and content are required for inventory generation");
  }
  if (!userId) throw new Error("User context required for lecture plan inventory");

  const inventoryPrompt = buildConceptInventoryPrompt(content, planSettings ?? {}, language);
  const chat = await callChat([{ type: "text", text: inventoryPrompt }], {
    reasoningEffort: "low",
    timeoutMs: 120000,
  });

  return {
    result: {
      inventory: chat.message,
      chunkIndex,
      totalChunks,
      label,
    },
    usage: {
      feature: "lecture_plan_v2",
      model: chat.model,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId,
      metadata: { pass: "inventory", chunkIndex, totalChunks, label },
    },
  };
};

const handleLecturePlanSynthesize = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
): Promise<JobRunResult> => {
  const { lectureId, runId, totalChunks, language = "en" } = payload ?? {};
  if (!lectureId || !runId) throw new Error("lectureId and runId are required for synthesis");
  if (!userId) throw new Error("User context required for lecture plan synthesis");

  let usage: UsageLogPayload | undefined = {
    feature: "lecture_plan_v2",
    lectureId,
    costUsd: 0,
  };
  const warnings: string[] = [];

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id,additional_notes,plan_settings")
    .eq("id", lectureId)
    .eq("user_id", userId)
    .single();
  if (lectureError) throw lectureError;

  const planSettings: PlanSettings = {
    preferredSessionMinutes: 45,
    targetGrade: "pass",
    ...((lecture.plan_settings as PlanSettings | null) ?? {}),
  };
  if (!planSettings.additionalNotes && lecture.additional_notes) {
    planSettings.additionalNotes = lecture.additional_notes;
  }

  const { data: inventoryJobs, error: inventoryError } = await supabase
    .from("jobs")
    .select("payload,result,created_at")
    .eq("type", "lecture_plan_inventory")
    .eq("status", "succeeded")
    .contains("payload", { lectureId, runId })
    .order("created_at", { ascending: true });
  if (inventoryError) throw inventoryError;
  if ((inventoryJobs?.length ?? 0) !== Number(totalChunks)) {
    throw new Error(`Missing inventory results (${inventoryJobs?.length ?? 0}/${totalChunks})`);
  }

  const conceptInventory = (inventoryJobs ?? [])
    .sort((a: any, b: any) => Number(a.payload?.chunkIndex ?? 0) - Number(b.payload?.chunkIndex ?? 0))
    .map((job: any) => `=== Concept inventory from ${job.payload?.label ?? "material batch"} ===\n${job.result?.inventory ?? ""}`)
    .join("\n\n");

  const pathPrompt = buildLearningPathPrompt(conceptInventory, planSettings, language);
  const pathChat = await callChat([{ type: "text", text: pathPrompt }], {
    reasoningEffort: "medium",
    timeoutMs: 180000,
  });
  usage = aggregateUsage(usage, {
    feature: "lecture_plan_v2",
    model: pathChat.model,
    usage: pathChat.usage,
    costUsd: pathChat.costUsd,
    inputCostUsd: pathChat.inputCostUsd,
    outputCostUsd: pathChat.outputCostUsd,
    lectureId,
    metadata: { pass: "path", inventoryChunks: totalChunks },
  });

  const parsedPath = parseLearningPath(pathChat.message);
  if (parsedPath.warnings.some((warning) => warning.toLowerCase().includes("fallback"))) {
    throw new Error("AI path synthesis did not return valid learning path JSON");
  }
  return await saveLecturePlanFromParsedPath(supabase, lectureId, userId, parsedPath, warnings, usage);
};

const handlePracticeExam = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
): Promise<JobRunResult> => {
  const { practiceExamId, lectureId, questionCount = 5, language = "en", category = null } = payload ?? {};
  if (!practiceExamId || !lectureId) {
    throw new Error("practiceExamId and lectureId are required");
  }
  if (!userId) throw new Error("User context required for practice exam generation");

  const isClusterQuiz = Boolean(category);

  const { data: examRow, error: examError } = await supabase
    .from("practice_exams")
    .select("*")
    .eq("id", practiceExamId)
    .eq("user_id", userId)
    .single();

  if (examError) throw examError;
  if (!examRow) throw new Error("Practice exam not found");

  // For cluster quizzes: get ALL entries in the category (to assess full cluster mastery)
  // For regular practice exams: get only passed entries (to reinforce learned material)
  let entriesQuery = supabase
    .from("study_plan_entries")
    .select("id,title,key_concepts,description,status,order_index,category")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId);

  if (isClusterQuiz) {
    // For cluster quiz: filter by category, include all entries regardless of status
    entriesQuery = entriesQuery.eq("category", category);
  } else {
    // For regular practice exam: only passed entries
    entriesQuery = entriesQuery.eq("status", "passed");
  }

  const { data: entries, error: entriesError } = await entriesQuery.order("order_index", { ascending: true });

  if (entriesError) throw entriesError;

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("id,name,extracted_text,is_exam")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId);

  if (filesError) throw filesError;

  const topicSummary =
    (entries ?? [])
      .map((entry: any, idx: number) => {
        const concepts = Array.isArray(entry.key_concepts) ? ` — ${entry.key_concepts.slice(0, 4).join(", ")}` : "";
        const statusNote = isClusterQuiz ? ` [${entry.status ?? "not_started"}]` : "";
        return `${idx + 1}. ${entry.title}${concepts}${statusNote}`;
      })
      .join("\n") || (isClusterQuiz ? "No topics in this cluster." : "No passed topics available.");

  const examText = (files ?? [])
    .filter((f: any) => f.is_exam)
    .map((f: any) => `=== ${f.name} (Exam) ===\n${f.extracted_text ?? ""}`)
    .join("\n\n");

  const worksheetText = (files ?? [])
    .filter((f: any) => !f.is_exam)
    .map((f: any) => `=== ${f.name} ===\n${f.extracted_text ?? ""}`)
    .join("\n\n");

  const prompt = practiceExamPrompt({
    topics: topicSummary,
    questionCount,
    examText: examText ? truncateToTokenLimit(examText, 6000) : undefined,
    worksheetText: worksheetText ? truncateToTokenLimit(worksheetText, 4000) : undefined,
    language,
    categoryName: isClusterQuiz ? category : undefined,
  });

  const chat = await callChat([{ type: "text", text: prompt }]);

  let parsed: Array<{ prompt: string; answer?: string; topicTitle?: string; source?: string }> = [];
  try {
    const clean = stripCodeFences(chat.message);
    const json = JSON.parse(clean);
    if (Array.isArray(json)) {
      parsed = json as any[];
    }
  } catch (err) {
    console.warn("[process-job][practice_exam] failed to parse prompt response", err);
  }

  if (parsed.length === 0) {
    parsed = [
      {
        prompt: isClusterQuiz 
          ? `Summarize one key concept from the "${category}" cluster.`
          : "Summarize one key concept from the passed topics.",
        answer: "Student provides a concise summary.",
        topicTitle: entries?.[0]?.title ?? "Review",
        source: "worksheet",
      },
    ];
  }

  const trimmed = parsed.slice(0, Math.max(1, questionCount));

  const questions = trimmed.map((item, idx) => {
    const normalizedTopic = (item.topicTitle ?? "").toLowerCase().trim();
    const matchedEntry =
      (entries ?? []).find((e: any) => (e.title ?? "").toLowerCase().trim() === normalizedTopic) ?? null;

    const normalizedSource = (() => {
      const s = (item.source ?? "").toLowerCase().trim();
      if (s === "exam") return "exam";
      if (s === "worksheet") return "worksheet";
      return "material";
    })();

    return {
      practice_exam_id: practiceExamId,
      user_id: userId,
      study_plan_entry_id: matchedEntry?.id ?? null,
      order_index: idx,
      prompt: sanitizeForDatabase(item.prompt ?? `Question ${idx + 1}`),
      answer_key: sanitizeForDatabase(item.answer ?? ""),
      source_type: normalizedSource,
      source_file_id: null,
    };
  });

  const { error: insertError } = await supabase.from("practice_exam_questions").insert(questions);
  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from("practice_exams")
    .update({
      status: "ready",
      question_count: questions.length,
      completed_at: null,
      error: null,
    })
    .eq("id", practiceExamId);

  if (updateError) throw updateError;

  return {
    result: { practiceExamId, questionCount: questions.length, category },
    usage: {
      feature: isClusterQuiz ? "cluster_quiz" : "practice_exam",
      model: chat.model ?? null,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId: lectureId ?? null,
      metadata: { questions: questions.length, category },
    },
  };
};

const handleMetadata = async (payload: any): Promise<JobRunResult> => {
  const { files = [], language = "en" } = payload ?? {};
  const summary = (files as Array<{ name: string; notes?: string }>)
    .map((f, idx) => `${idx + 1}. ${f.name}${f.notes ? ` — ${f.notes}` : ""}`)
    .join("\n");

  const prompt = lectureMetadataPrompt(summary || "No details provided.", language);
  const chat = await callChat([{ type: "text", text: prompt }]);

  let parsedTitle = "New Lecture";
  let parsedDescription = "";

  try {
    const clean = stripCodeFences(chat.message);
    const parsed = JSON.parse(clean);
    parsedTitle = parsed.title ?? parsedTitle;
    parsedDescription = parsed.description ?? parsedDescription;
  } catch {
    parsedDescription = chat.message;
  }

  return {
    result: { title: parsedTitle, description: parsedDescription },
    usage: {
      feature: "metadata",
      model: chat.model ?? null,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId: payload?.lectureId ?? payload?.lecture_id ?? null,
    },
  };
};

const handleChat = async (payload: any): Promise<JobRunResult> => {
  const { messages = [], materialContext = "", language = "en", lectureId } = payload ?? {};
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
  return {
    result: { message: reply.message },
    usage: {
      feature: "chat",
      model: reply.model ?? null,
      usage: reply.usage,
      costUsd: reply.costUsd,
      inputCostUsd: reply.inputCostUsd,
      outputCostUsd: reply.outputCostUsd,
      lectureId: lectureId ?? null,
    },
  };
};

// Streaming chat handler that updates partial_result as tokens arrive
const handleChatStreaming = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  jobId: string,
): Promise<JobRunResult> => {
  const { messages = [], materialContext = "", language = "en", lectureId } = payload ?? {};
  const truncatedContext = truncateToTokenLimit(materialContext ?? "", 500000);
  const systemPrompt = feynmanSystemPrompt(truncatedContext, language);
  const fullMessages = [
    { role: "system", content: systemPrompt },
    ...(messages as Array<{ role: string; content: string }>).map((m) => ({
      role: m.role,
      content: String(m.content ?? ""),
    })),
  ];

  // Track time of last update to throttle DB writes
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL_MS = 150; // Update every 150ms max

  const reply = await callChatWithMessagesStream(fullMessages as any, {
    onChunk: async (_chunk, fullText) => {
      const now = Date.now();
      if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
        lastUpdateTime = now;
        // Update partial_result in the database for Realtime subscribers
        await supabase
          .from("jobs")
          .update({ partial_result: fullText })
          .eq("id", jobId);
      }
    },
  });

  return {
    result: { message: reply.message },
    usage: {
      feature: "chat",
      model: reply.model ?? null,
      usage: reply.usage,
      costUsd: reply.costUsd,
      inputCostUsd: reply.inputCostUsd,
      outputCostUsd: reply.outputCostUsd,
      lectureId: lectureId ?? null,
    },
  };
};

const handleGrade = async (payload: any): Promise<JobRunResult> => {
  const {
    question,
    answerText,
    answerImageDataUrl,
    language = "en",
    lectureId,
    gradingContext,
  } = payload ?? {};
  if (!question || !question.prompt) {
    throw new Error("question.prompt is required");
  }

  const content: any[] = [
    { type: "text", text: gradingPrompt(question, answerText, language, gradingContext) },
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

  const chat = await callChat(content);

  let feedback: any = null;
  try {
    feedback = JSON.parse(chat.message);
  } catch {
    feedback = {
      summary: chat.message,
      correctness: "unknown",
    };
  }

  return {
    result: {
        feedback: {
          summary: feedback.summary ?? "No summary",
          correctness: feedback.correctness ?? "unknown",
          score: feedback.score ?? undefined,
          improvements: Array.isArray(feedback.improvements) ? feedback.improvements : [],
          misconceptions: Array.isArray(feedback.misconceptions) ? feedback.misconceptions : [],
          followUpQuestion: typeof feedback.followUpQuestion === "string" ? feedback.followUpQuestion : undefined,
          sourceNotes: Array.isArray(feedback.sourceNotes) ? feedback.sourceNotes : [],
        },
      },
    usage: {
      feature: "grade",
      model: chat.model ?? null,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId: lectureId ?? null,
    },
  };
};

const handleEmbed = async (payload: any): Promise<JobRunResult> => {
  const { inputs, lectureId } = payload ?? {};
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("inputs must be a non-empty array");
  }
  const embeddingResult = await embedTexts(inputs.map((i: any) => String(i)));
  return {
    result: { embeddings: embeddingResult.embeddings },
    usage: {
      feature: "embed",
      model: embeddingResult.model ?? null,
      usage: embeddingResult.usage,
      costUsd: embeddingResult.costUsd,
      inputCostUsd: embeddingResult.inputCostUsd,
      outputCostUsd: embeddingResult.outputCostUsd,
      lectureId: lectureId ?? null,
    },
  };
};

const handleTranscribe = async (payload: any): Promise<JobRunResult> => {
  const { audioUrl, language = "en", durationSeconds, lectureId } = payload ?? {};
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
  formData.append("model", OPENAI_TRANSCRIBE_MODEL);
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
  const usage = toTokenUsage(data);
  const audioDurationSeconds =
    typeof data?.duration === "number"
      ? data.duration
      : typeof durationSeconds === "number"
        ? durationSeconds
        : undefined;

  return {
    result: { text: data.text || "" },
    usage: {
      feature: "transcribe",
      model: data?.model ?? OPENAI_TRANSCRIBE_MODEL,
      usage,
      audioDurationSeconds,
      lectureId: lectureId ?? null,
      metadata: { language },
    },
  };
};

const runJob = async (
  job: Job,
  supabase: ReturnType<typeof createClient>,
): Promise<JobRunResult> => {
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
    case "practice_exam":
      return await handlePracticeExam(job.payload, supabase, job.user_id);
    case "lecture_plan_v2":
      return await handleLecturePlanV2(job.payload, supabase, job.user_id);
    case "lecture_plan_inventory":
      return await handleLecturePlanInventory(job.payload, supabase, job.user_id);
    case "lecture_plan_synthesize":
      return await handleLecturePlanSynthesize(job.payload, supabase, job.user_id);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
};

const enqueueSynthesisIfReady = async (
  supabase: ReturnType<typeof createClient>,
  inventoryJob: Job,
) => {
  const { lectureId, runId, totalChunks, language = "en" } = inventoryJob.payload ?? {};
  if (!lectureId || !runId || !totalChunks || !inventoryJob.user_id) return;

  const { count: succeededCount, error: countError } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("type", "lecture_plan_inventory")
    .eq("status", "succeeded")
    .contains("payload", { lectureId, runId });
  if (countError) throw countError;
  if ((succeededCount ?? 0) !== Number(totalChunks)) return;

  const { count: existingCount, error: existingError } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("type", "lecture_plan_synthesize")
    .in("status", ["pending", "running", "succeeded"])
    .contains("payload", { lectureId, runId });
  if (existingError) throw existingError;
  if ((existingCount ?? 0) > 0) return;

  await enqueueInternalJob(supabase, inventoryJob.user_id, "lecture_plan_synthesize", {
    lectureId,
    runId,
    totalChunks,
    language,
  });
};

const processPlanJob = async (supabase: ReturnType<typeof createClient>, locked: Job) => {
  try {
    console.log("[process-job] Background plan job started:", locked.id);
    const jobResult = await runJob(locked as Job, supabase);
    console.log("[process-job] Background plan job completed:", locked.id);

    // Log usage
    if (jobResult.usage) {
      await insertUsageLog({
        supabase,
        userId: locked.user_id,
        lectureId: jobResult.usage.lectureId ?? null,
        jobId: locked.id,
        feature: jobResult.usage.feature,
        model: jobResult.usage.model ?? null,
        usage: jobResult.usage.usage,
        costUsd: jobResult.usage.costUsd,
        inputCostUsd: jobResult.usage.inputCostUsd,
        outputCostUsd: jobResult.usage.outputCostUsd,
        audioDurationSeconds: jobResult.usage.audioDurationSeconds,
        metadata: jobResult.usage.metadata ?? null,
      });
    }

    const { error: updateError } = await supabase
      .from("jobs")
      .update({
        status: "succeeded",
        result: { ...jobResult.result, costUsd: jobResult.usage?.costUsd },
        completed_at: new Date().toISOString(),
      })
      .eq("id", locked.id);

    if (updateError) {
      console.error("[process-job] update success error (plan)", updateError);
      throw updateError;
    }

    if (locked.type === "lecture_plan_v2") {
      kickProcessJob();
    }
  } catch (jobError: any) {
    console.error("[process-job] background job failed", jobError);
    if (locked.type.startsWith("lecture_plan")) {
      const lectureId = locked.payload?.lectureId ?? locked.payload?.lecture_id;
      if (lectureId) {
        await supabase
          .from("lectures")
          .update({
            plan_status: "failed",
            plan_generated_at: null,
            plan_error: jobError?.message?.slice(0, 500) ?? "Job failed",
          })
          .eq("id", lectureId);
      }
    }
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error: jobError?.message?.slice(0, 500) ?? "Job failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", locked.id);
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
    let requestedJobId: string | null = null;
    try {
      const body = await req.clone().json();
      requestedJobId = typeof body?.jobId === "string" ? body.jobId : null;
    } catch {
      requestedJobId = null;
    }

    // Pick oldest pending job
    console.log("[process-job] Looking for pending jobs...");
    let pendingQuery = supabase.from("jobs").select("*").eq("status", "pending");
    if (requestedJobId) {
      pendingQuery = pendingQuery.eq("id", requestedJobId);
    } else {
      pendingQuery = pendingQuery.order("created_at", { ascending: true }).limit(1);
    }
    const { data: pending, error: fetchError } = await pendingQuery.maybeSingle();

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
      if (locked.type === "plan" || locked.type === "lecture_plan_v2") {
        console.log("[process-job] Scheduling background job:", locked.id);
        const backgroundPromise = processPlanJob(supabase, locked as Job);
        try {
          EdgeRuntime.waitUntil(backgroundPromise);
        } catch (err) {
          console.warn("[process-job] EdgeRuntime.waitUntil unavailable, running inline", err);
          await backgroundPromise;
        }
        return new Response(
          JSON.stringify({ message: "background job scheduled", id: locked.id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Use streaming for chat jobs to enable real-time UI updates
      let jobResult: JobRunResult;
      if (locked.type === "chat") {
        jobResult = await handleChatStreaming(locked.payload, supabase, locked.id);
      } else {
        jobResult = await runJob(locked as Job, supabase);
      }
      console.log("[process-job] Job completed successfully:", locked.id);

      // Log usage
      if (jobResult.usage) {
        await insertUsageLog({
          supabase,
          userId: locked.user_id,
          lectureId: jobResult.usage.lectureId ?? null,
          jobId: locked.id,
          feature: jobResult.usage.feature,
          model: jobResult.usage.model ?? null,
          usage: jobResult.usage.usage,
          costUsd: jobResult.usage.costUsd,
          inputCostUsd: jobResult.usage.inputCostUsd,
          outputCostUsd: jobResult.usage.outputCostUsd,
          audioDurationSeconds: jobResult.usage.audioDurationSeconds,
          metadata: jobResult.usage.metadata ?? null,
        });
      }

      result = { ...jobResult.result, costUsd: jobResult.usage?.costUsd };
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

      if (locked.type === "lecture_plan_inventory") {
        await enqueueSynthesisIfReady(supabase, locked as Job);
        kickProcessJob();
      }
    } catch (jobError: any) {
      console.error("[process-job] job failed", jobError);
      if (locked.type.startsWith("lecture_plan")) {
        const lectureId = locked.payload?.lectureId ?? locked.payload?.lecture_id;
        if (lectureId) {
          await supabase
            .from("lectures")
            .update({
              plan_status: "failed",
              plan_generated_at: null,
              plan_error: jobError?.message?.slice(0, 500) ?? "Job failed",
            })
            .eq("id", lectureId);
        }
      }
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
