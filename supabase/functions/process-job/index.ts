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
  resolveAIProviderRequest,
  sanitizeForDatabase,
  stripCodeFences,
  truncateToTokenLimit,
} from "../_shared/openai.ts";
import { loadUserAISettings, UserAISettings } from "../_shared/ai-settings.ts";
import { toTokenUsage } from "../_shared/openai-response-utils.ts";
import {
  cheatSheetPrompt,
  feynmanSystemPrompt,
  gradingPrompt,
  lectureMetadataPrompt,
  practiceExamPrompt,
  questionPrompt,
  studyPlanPrompt,
  warmupQuestionPrompt,
} from "../_shared/prompts.ts";
import {
  buildConceptInventoryPrompt,
  buildLearningPathPrompt,
  findUndercoveredSources,
  parseLearningPath,
  ParsedPlanEntry,
  PlanSettings,
  SourceCoverageGap,
  SourceCoverageInput,
} from "../_shared/study-plan-v2.ts";
import {
  groupPdfTextItemsIntoLines,
  splitTextIntoLineChunks,
} from "../_shared/pdf-source.ts";
import { insertUsageLog } from "../_shared/usage.ts";
import { captureSentryException, setSentryJobContext, withSentry } from "../_shared/sentry.ts";
import { calculateReadinessFallbackPercentage } from "../_shared/readiness.ts";

// EdgeRuntime is available in Supabase Edge Functions for background work
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const PDF_EXTRACTION_TIMEOUT_MS = Number(Deno.env.get("PDF_EXTRACTION_TIMEOUT_MS") || "90000");

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
    reasoningTokens?: number;
  };
  costUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  lectureId?: string | null;
  audioDurationSeconds?: number;
  metadata?: Record<string, unknown>;
};

type JobRunResult = { result: any; usage?: UsageLogPayload };

const percentageToGrade = (percentage: number) => {
  const clamped = Math.max(0, Math.min(100, percentage));
  if (clamped >= 85.5) return "1.0";
  if (clamped >= 81) return "1.3";
  if (clamped >= 76.5) return "1.7";
  if (clamped >= 72) return "2.0";
  if (clamped >= 67.5) return "2.3";
  if (clamped >= 63) return "2.7";
  if (clamped >= 58.5) return "3.0";
  if (clamped >= 54) return "3.3";
  if (clamped >= 49.5) return "3.7";
  if (clamped >= 45) return "4.0";
  return "Failed";
};

const noJobResponse = () =>
  new Response(JSON.stringify({ message: "no pending jobs" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const kickProcessJob = (jobId?: string) => {
  if (!SUPABASE_URL) return;
  const token = SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return;

  return fetch(`${SUPABASE_URL}/functions/v1/process-job`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "process-job", jobId }),
  }).catch((error) => console.error("[process-job] follow-up kick failed", error));
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

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const inferAudioFormat = (file: File) => {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.includes("wav") || name.endsWith(".wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3") || name.endsWith(".mp3")) return "mp3";
  if (mime.includes("webm") || name.endsWith(".webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || name.endsWith(".m4a")) return "m4a";
  return "m4a";
};

type ExtractedPage = { pageNumber: number; text: string; lines?: string[] };
type LecturePlanFile = {
  id: string;
  name: string;
  uri: string;
  extracted_text?: string | null;
  extracted_pages?: unknown;
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

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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
  const pdfResponse = await fetch(pdfUrl, { signal: AbortSignal.timeout(PDF_EXTRACTION_TIMEOUT_MS) });
  if (!pdfResponse.ok) throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const pages: ExtractedPage[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupPdfTextItemsIntoLines((textContent.items ?? []) as any[]);
    const text = lines.join("\n");
    const sanitized = sanitizeForDatabase(text);
    if (sanitized) pages.push({ pageNumber, text: sanitized, lines });
  }
  return pages;
};

const extractPdfPagesWithTimeout = (pdfUrl: string, fileName: string) =>
  withTimeout(extractPdfPages(pdfUrl), PDF_EXTRACTION_TIMEOUT_MS, `PDF extraction for ${fileName}`);

const parseStoredExtractedPages = (value: unknown): ExtractedPage[] => {
  if (!Array.isArray(value)) return [];
  const pages: ExtractedPage[] = [];

  value.forEach((page: any, index) => {
    const pageNumber = Number(page?.pageNumber ?? page?.page_number ?? index + 1);
    const lines = Array.isArray(page?.lines)
      ? page.lines.map((line: unknown) => sanitizeForDatabase(String(line ?? ""))).filter(Boolean)
      : undefined;
    const text = sanitizeForDatabase(
      String(page?.text ?? (lines ? lines.join("\n") : "")),
    );
    if (!text) return;
    pages.push({
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : index + 1,
      text,
      lines,
    });
  });

  return pages;
};

const buildLectureFileChunkRows = (
  lectureId: string,
  files: Array<{ id: string; extracted_text?: string | null; extracted_pages?: unknown }>,
) => {
  const chunkRows: any[] = [];

  for (const file of files) {
    const storedPages = parseStoredExtractedPages(file.extracted_pages);
    const pages =
      storedPages.length > 0
        ? storedPages
        : [{ pageNumber: 1, text: sanitizeForDatabase(String(file.extracted_text ?? "")) }];

    pages.forEach((page) => {
      splitTextIntoLineChunks(page.text).forEach((chunk, chunkIndex) => {
        chunkRows.push({
          lecture_id: lectureId,
          lecture_file_id: file.id,
          page_number: page.pageNumber,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          chunk_index: chunkIndex,
          content: chunk.content,
          content_hash: hashText(`${file.id}:${page.pageNumber}:${chunk.startLine}:${chunk.endLine}:${chunk.content}`),
        });
      });
    });
  }

  return chunkRows;
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
    reasoningTokens: (current?.usage?.reasoningTokens ?? 0) + (next.usage?.reasoningTokens ?? 0),
  },
  costUsd: (current?.costUsd ?? 0) + (next.costUsd ?? 0),
  inputCostUsd: (current?.inputCostUsd ?? 0) + (next.inputCostUsd ?? 0),
  outputCostUsd: (current?.outputCostUsd ?? 0) + (next.outputCostUsd ?? 0),
  lectureId: next.lectureId ?? current?.lectureId ?? null,
  metadata: { ...(current?.metadata ?? {}), ...(next.metadata ?? {}) },
});

const handleLecturePdfReindex = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const { lectureId, forceExtract = true } = payload ?? {};
  if (!lectureId) throw new Error("lectureId is required");
  if (!userId) throw new Error("User context required for lecture PDF reindexing");

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id,title")
    .eq("id", lectureId)
    .eq("user_id", userId)
    .single();
  if (lectureError) throw lectureError;
  if (!lecture) throw new Error("Lecture not found");

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("id,name,uri,extracted_text,extracted_pages")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (filesError) throw filesError;
  if (!files?.length) throw new Error("Lecture has no files");

  const filesForIndex: Array<{
    id: string;
    extracted_text?: string | null;
    extracted_pages?: unknown;
  }> = [];
  let extractedFiles = 0;
  let reusedFiles = 0;
  let pageCount = 0;

  for (const file of files as LecturePlanFile[]) {
    const storedPages = parseStoredExtractedPages(file.extracted_pages);
    const shouldExtract = forceExtract || storedPages.length === 0;
    let pages = storedPages;

    if (shouldExtract) {
      pages = await extractPdfPagesWithTimeout(file.uri, file.name);
      const fullText = pages.map((page) => page.text).join("\n\n");
      if (!fullText.trim()) {
        throw new Error(`PDF text extraction returned no text for ${file.name}`);
      }

      await supabase
        .from("lecture_files")
        .update({
          extracted_text: fullText,
          extracted_pages: pages.map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            lines: page.lines ?? page.text.split("\n").filter(Boolean),
          })),
        })
        .eq("id", file.id)
        .eq("user_id", userId);
      extractedFiles += 1;
    } else {
      reusedFiles += 1;
    }

    pageCount += pages.length;
    filesForIndex.push({
      id: file.id,
      extracted_text: pages.map((page) => page.text).join("\n\n"),
      extracted_pages: pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
        lines: page.lines ?? page.text.split("\n").filter(Boolean),
      })),
    });
  }

  const chunkRows = buildLectureFileChunkRows(lectureId, filesForIndex);
  if (chunkRows.length === 0) throw new Error("No PDF text available for embeddings");

  const embeddingResult = await embedTexts(chunkRows.map((chunk) => chunk.content), {
    aiSettings,
    useCase: "embeddings",
  });

  await supabase.from("lecture_file_chunks").delete().eq("lecture_id", lectureId);

  const rowsWithEmbeddings = chunkRows.map((chunk, idx) => ({
    ...chunk,
    embedding: embeddingResult.embeddings[idx],
  }));
  const { error: chunkInsertError } = await supabase
    .from("lecture_file_chunks")
    .upsert(rowsWithEmbeddings, { onConflict: "content_hash" });
  if (chunkInsertError) throw chunkInsertError;

  return {
    result: {
      lectureId,
      lectureTitle: lecture.title,
      files: files.length,
      extractedFiles,
      reusedFiles,
      pages: pageCount,
      chunks: chunkRows.length,
    },
    usage: {
      feature: "lecture_pdf_reindex",
      model: embeddingResult.model,
      usage: embeddingResult.usage,
      costUsd: embeddingResult.costUsd,
      inputCostUsd: embeddingResult.inputCostUsd,
      outputCostUsd: embeddingResult.outputCostUsd,
      lectureId,
      metadata: {
        forceExtract,
        files: files.length,
        extractedFiles,
        reusedFiles,
        pages: pageCount,
        chunks: chunkRows.length,
      },
    },
  };
};

const normalizeFileName = (value: unknown) => String(value ?? "").trim().toLowerCase();

const missingSourceFilesForPath = (
  parsedPath: ReturnType<typeof parseLearningPath>,
  sourceFiles: string[],
) => {
  const referenced = new Set<string>();
  parsedPath.entries.forEach((entry) => {
    (entry.sourceRefs ?? []).forEach((ref) => {
      const fileName = normalizeFileName(ref.fileName);
      if (fileName) referenced.add(fileName);
    });
  });

  return sourceFiles.filter((fileName) => !referenced.has(normalizeFileName(fileName)));
};

const assertCompleteSourceCoverage = (
  parsedPath: ReturnType<typeof parseLearningPath>,
  sourceFiles: string[],
) => {
  const missing = missingSourceFilesForPath(parsedPath, sourceFiles);
  if (missing.length > 0) {
    throw new Error(`Learning path missed uploaded source files: ${missing.join(", ")}`);
  }
};

const assertSourceCoverageQuality = (
  parsedPath: ReturnType<typeof parseLearningPath>,
  sources: SourceCoverageInput[],
) => {
  const undercovered = findUndercoveredSources(parsedPath, sources);
  if (undercovered.length > 0) {
    throw new Error(
      `Learning path undercovered uploaded source files: ${undercovered
        .map((gap) => `${gap.fileName} (${gap.currentRefs}/${gap.requiredRefs})`)
        .join(", ")}`,
    );
  }
};

const buildCoverageRepairMaterial = (
  gaps: SourceCoverageGap[],
  files: Array<{ name?: string | null; extracted_text?: string | null; is_exam?: boolean | null }>,
) => gaps
  .map((gap) => {
    const file = files.find((item) => normalizeFileName(item.name) === normalizeFileName(gap.fileName));
    const text = sanitizeForDatabase(String(file?.extracted_text ?? ""));
    const excerpt = text ? truncateToTokenLimit(text, 900) : "No extracted text excerpt available.";
    return `=== ${gap.fileName} (${gap.currentRefs}/${gap.requiredRefs} refs, ${gap.reason}) ===\n${excerpt}`;
  })
  .join("\n\n");

const learningPathPromptJson = (parsedPath: ReturnType<typeof parseLearningPath>) => ({
  modules: parsedPath.modules.map((module) => ({
    id: module.clientId,
    title: module.title,
    summary: module.summary,
    estimatedMinutes: module.estimatedMinutes,
  })),
  entries: parsedPath.entries.map((entry) => ({
    id: entry.clientId,
    moduleId: entry.moduleClientId,
    title: entry.title,
    description: entry.description,
    learningObjective: entry.learningObjective,
    keyConcepts: entry.keyConcepts,
    category: entry.category,
    importanceTier: entry.importanceTier,
    priorityScore: entry.priorityScore,
    difficulty: entry.difficulty,
    estimatedMinutes: entry.estimatedMinutes,
    prerequisites: entry.prerequisiteClientIds,
    sequenceReason: entry.sequenceReason,
    fromExamSource: entry.fromExamSource,
    examRelevance: entry.examRelevance,
    mentionedInNotes: entry.mentionedInNotes,
    sourceRefs: entry.sourceRefs,
  })),
});

const handlePlan = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
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

        const chat = await callChat([{ type: "text", text: prompt }], {
          aiSettings,
          useCase: "study_plan",
        });
        console.log(`[process-job][plan] Completed chunk ${chunkIndex + 1}/${chunks.length}`);

        if (chat.usage) {
          aggregatedUsage = {
            promptTokens: (aggregatedUsage?.promptTokens ?? 0) + (chat.usage.promptTokens ?? 0),
            completionTokens:
              (aggregatedUsage?.completionTokens ?? 0) + (chat.usage.completionTokens ?? 0),
            totalTokens: (aggregatedUsage?.totalTokens ?? 0) + (chat.usage.totalTokens ?? 0),
            reasoningTokens:
              (aggregatedUsage?.reasoningTokens ?? 0) + (chat.usage.reasoningTokens ?? 0),
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
  _aiSettings: UserAISettings,
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
    .select("id,name,uri,extracted_text,extracted_pages,is_exam")
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
    const storedPages = parseStoredExtractedPages(file.extracted_pages);
    if (!regenerate && storedPages.length > 0) {
      pages = storedPages;
    } else if (!regenerate && file.extracted_text?.trim()) {
      pages = [{ pageNumber: 1, text: sanitizeForDatabase(file.extracted_text) }];
    } else {
      try {
        pages = await extractPdfPagesWithTimeout(file.uri, file.name);
        const fullText = pages.map((page) => page.text).join("\n\n");
        if (!fullText.trim()) {
          throw new Error("PDF text extraction returned no text");
        }
        await supabase
          .from("lecture_files")
          .update({
            extracted_text: fullText,
            extracted_pages: pages.map((page) => ({
              pageNumber: page.pageNumber,
              text: page.text,
              lines: page.lines ?? page.text.split("\n").filter(Boolean),
            })),
          })
          .eq("id", file.id)
          .eq("user_id", userId);
      } catch (error: any) {
        throw new Error(`Could not extract ${file.name}: ${error?.message ?? String(error)}`);
      }
    }

    const fullText = pages.map((page) => page.text).join("\n\n");
    extractedTexts.push({
      fileName: file.name,
      text: fullText || `PDF Document: ${file.name}.`,
      isExam: Boolean(file.is_exam),
    });
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
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  warnings.push(...parsedPath.warnings);

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("id,name,extracted_text,extracted_pages")
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

  const chunkRows = buildLectureFileChunkRows(lectureId, files ?? []);

  if (chunkRows.length > 0) {
    const embeddingResult = await embedTexts(chunkRows.map((chunk) => chunk.content), {
      aiSettings,
      useCase: "embeddings",
    });
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
  aiSettings: UserAISettings,
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
    aiSettings,
    useCase: "study_plan_inventory",
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
  aiSettings: UserAISettings,
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

  const { data: files, error: filesError } = await supabase
    .from("lecture_files")
    .select("name,extracted_text,is_exam")
    .eq("lecture_id", lectureId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (filesError) throw filesError;
  const sourceFiles: string[] = (files ?? [])
    .map((file: any) => String(file.name ?? "").trim())
    .filter((fileName: string) => Boolean(fileName));
  const sourceCoverageInputs: SourceCoverageInput[] = (files ?? [])
    .map((file: any) => ({
      fileName: String(file.name ?? "").trim(),
      textLength: String(file.extracted_text ?? "").length,
      isExam: Boolean(file.is_exam),
    }))
    .filter((source: SourceCoverageInput) => Boolean(source.fileName));

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

  const entryTarget = sourceFiles.length >= 25
    ? { minEntries: 36, maxEntries: 56, minModules: 7, maxModules: 12 }
    : sourceFiles.length >= 12
      ? { minEntries: 20, maxEntries: 36, minModules: 5, maxModules: 10 }
      : { minEntries: 10, maxEntries: 24, minModules: 3, maxModules: 8 };

  const pathPrompt = buildLearningPathPrompt(conceptInventory, planSettings, language, {
    sourceFiles,
    sourceCoverageRequirements: findUndercoveredSources({ entries: [] }, sourceCoverageInputs),
    ...entryTarget,
  });
  const pathChat = await callChat([{ type: "text", text: pathPrompt }], {
    aiSettings,
    useCase: "study_plan_synthesis",
    timeoutMs: 480000,
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

  let parsedPath = parseLearningPath(pathChat.message);
  if (parsedPath.warnings.some((warning) => warning.toLowerCase().includes("fallback"))) {
    throw new Error("AI path synthesis did not return valid learning path JSON");
  }
  let missingSourceFiles = missingSourceFilesForPath(parsedPath, sourceFiles);
  if (missingSourceFiles.length > 0) {
    const repairPrompt = `The generated learning path is too compressed and missed uploaded source files.

Missing source files:
${missingSourceFiles.map((fileName) => `- ${fileName}`).join("\n")}

All uploaded source files:
${sourceFiles.map((fileName) => `- ${fileName}`).join("\n")}

Current JSON:
${pathChat.message}

Return a complete replacement JSON only. Keep prerequisite ordering, keep session-sized entries, include dedicated exam-practice/review sessions, and ensure every uploaded source file appears at least once in sourceRefs using the exact fileName. Target ${entryTarget.minEntries}-${entryTarget.maxEntries} entries across ${entryTarget.minModules}-${entryTarget.maxModules} modules.`;

    const repairChat = await callChat([{ type: "text", text: repairPrompt }], {
      aiSettings,
      useCase: "study_plan_synthesis",
      timeoutMs: 480000,
    });
    usage = aggregateUsage(usage, {
      feature: "lecture_plan_v2",
      model: repairChat.model,
      usage: repairChat.usage,
      costUsd: repairChat.costUsd,
      inputCostUsd: repairChat.inputCostUsd,
      outputCostUsd: repairChat.outputCostUsd,
      lectureId,
      metadata: { pass: "coverage-repair", missingSourceFiles: missingSourceFiles.length },
    });
    parsedPath = parseLearningPath(repairChat.message);
    if (parsedPath.warnings.some((warning) => warning.toLowerCase().includes("fallback"))) {
      throw new Error("AI path repair did not return valid learning path JSON");
    }
    missingSourceFiles = missingSourceFilesForPath(parsedPath, sourceFiles);
  }
  assertCompleteSourceCoverage(parsedPath, sourceFiles);
  let undercoveredSources = findUndercoveredSources(parsedPath, sourceCoverageInputs);
  if (undercoveredSources.length > 0) {
    const coverageRepairPrompt = `The generated learning path references every uploaded PDF, but some PDFs are under-covered. Expand the plan so these sources get enough distinct, focused study sessions.

Under-covered source files:
${undercoveredSources.map((gap) => `- ${gap.fileName}: ${gap.currentRefs}/${gap.requiredRefs} current references. ${gap.reason}.`).join("\n")}

Relevant source excerpts:
${buildCoverageRepairMaterial(undercoveredSources, files ?? [])}

Current JSON:
${JSON.stringify(learningPathPromptJson(parsedPath), null, 2)}

Return a complete replacement JSON only. Keep prerequisite ordering and the existing module-based structure. Add or split entries for distinct teachable concepts from the under-covered PDFs; do not satisfy coverage by attaching sourceRefs to unrelated broad sessions. Every listed under-covered file must appear in at least its required number of distinct entries. Keep sessions close to ${planSettings.preferredSessionMinutes ?? 45} minutes. Target ${Math.max(entryTarget.minEntries, parsedPath.entries.length + undercoveredSources.length)}-${Math.max(entryTarget.maxEntries, parsedPath.entries.length + undercoveredSources.length * 2)} entries across ${entryTarget.minModules}-${entryTarget.maxModules} modules.`;

    const coverageRepairChat = await callChat([{ type: "text", text: coverageRepairPrompt }], {
      aiSettings,
      useCase: "study_plan_synthesis",
      timeoutMs: 480000,
    });
    usage = aggregateUsage(usage, {
      feature: "lecture_plan_v2",
      model: coverageRepairChat.model,
      usage: coverageRepairChat.usage,
      costUsd: coverageRepairChat.costUsd,
      inputCostUsd: coverageRepairChat.inputCostUsd,
      outputCostUsd: coverageRepairChat.outputCostUsd,
      lectureId,
      metadata: { pass: "coverage-expansion", undercoveredSourceFiles: undercoveredSources.length },
    });
    parsedPath = parseLearningPath(coverageRepairChat.message);
    if (parsedPath.warnings.some((warning) => warning.toLowerCase().includes("fallback"))) {
      throw new Error("AI coverage expansion did not return valid learning path JSON");
    }
    assertCompleteSourceCoverage(parsedPath, sourceFiles);
    undercoveredSources = findUndercoveredSources(parsedPath, sourceCoverageInputs);
  }
  assertSourceCoverageQuality(parsedPath, sourceCoverageInputs);
  return await saveLecturePlanFromParsedPath(
    supabase,
    lectureId,
    userId,
    parsedPath,
    warnings,
    usage,
    aiSettings,
  );
};

const handlePracticeExam = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  aiSettings: UserAISettings,
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

  const chat = await callChat([{ type: "text", text: prompt }], {
    aiSettings,
    useCase: "practice_exam",
  });

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

const handleQuestionGeneration = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const {
    materialTitle = "Study material",
    outline = "",
    count = 3,
    language = "en",
  } = payload ?? {};
  const questionCount = Number.isFinite(Number(count))
    ? Math.max(1, Math.min(20, Math.round(Number(count))))
    : 3;
  const truncatedOutline = truncateToTokenLimit(String(outline ?? ""), 500000);
  if (payload?.format === "multiple_choice") {
    const prompt = warmupQuestionPrompt(String(materialTitle), truncatedOutline, questionCount, language);
    const chat = await callChat([{ type: "text", text: prompt }], {
      aiSettings,
      useCase: "question_generation",
    });

    let parsed: any[] = [];
    try {
      const value = JSON.parse(stripCodeFences(chat.message));
      parsed = Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn("[question_generation] failed to parse warm-up JSON", error);
    }

    const questions = parsed
      .map((item: any, idx: number) => {
        const options = Array.isArray(item?.options)
          ? item.options.map((option: unknown) => String(option ?? "").trim()).filter(Boolean)
          : [];
        const correctOptionIndex = Number(item?.correctOptionIndex);
        if (
          !String(item?.prompt ?? "").trim() ||
          options.length !== 4 ||
          !Number.isInteger(correctOptionIndex) ||
          correctOptionIndex < 0 ||
          correctOptionIndex >= options.length
        ) {
          return null;
        }

        const shuffled = shuffleWarmupOptions(options, correctOptionIndex);

        return {
          id: `warmup-${idx}`,
          prompt: String(item.prompt).trim(),
          options: shuffled.options,
          correctOptionIndex: shuffled.correctOptionIndex,
          explanation: String(item?.explanation ?? "").trim() || options[correctOptionIndex],
          targetConcepts: Array.isArray(item?.targetConcepts)
            ? item.targetConcepts.map((concept: unknown) => String(concept ?? "").trim()).filter(Boolean)
            : undefined,
        };
      })
      .filter(Boolean)
      .slice(0, questionCount);

    return {
      result: { questions },
      usage: {
        feature: "question_generation",
        model: chat.model ?? null,
        usage: chat.usage,
        costUsd: chat.costUsd,
        inputCostUsd: chat.inputCostUsd,
        outputCostUsd: chat.outputCostUsd,
        lectureId: payload?.lectureId ?? payload?.lecture_id ?? null,
        metadata: { questions: questions.length, format: "multiple_choice" },
      },
    };
  }

  const prompt = questionPrompt(String(materialTitle), truncatedOutline, questionCount, language);
  const chat = await callChat([{ type: "text", text: prompt }], {
    aiSettings,
    useCase: "question_generation",
  });

  const questions = chat.message
    .split("\n")
    .map((line: string) => line.replace(/^\d+[\).\s]*/, "").trim())
    .filter(Boolean)
    .slice(0, questionCount)
    .map((prompt: string, idx: number) => ({ id: `q-${idx}`, prompt }));

  return {
    result: { questions },
    usage: {
      feature: "question_generation",
      model: chat.model ?? null,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId: payload?.lectureId ?? payload?.lecture_id ?? null,
      metadata: { questions: questions.length },
    },
  };
};

const shuffleWarmupOptions = (options: string[], correctOptionIndex: number) => {
  const keyed = options.map((option, index) => ({
    option,
    isCorrect: index === correctOptionIndex,
  }));

  for (let index = keyed.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [keyed[index], keyed[swapIndex]] = [keyed[swapIndex], keyed[index]];
  }

  return {
    options: keyed.map((item) => item.option),
    correctOptionIndex: Math.max(0, keyed.findIndex((item) => item.isCorrect)),
  };
};

const handleReadinessRoadmap = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const {
    planEntries = [],
    additionalNotes,
    progress = { passed: 0, inProgress: 0, notStarted: 0, failed: 0 },
    language = "en",
    clusterQuizResults = [],
    stageProgress,
  } = payload ?? {};
  const entries = Array.isArray(planEntries) ? planEntries : [];
  const quizzes = Array.isArray(clusterQuizResults) ? clusterQuizResults : [];
  const passedClusters = quizzes.filter((q: any) => q.passed).length;
  const totalClusters = quizzes.length;
  const avgQuizScore = quizzes.length > 0
    ? quizzes.reduce((sum: number, q: any) => sum + (Number(q.score) || 0), 0) / quizzes.length
    : 0;
  const fallbackPercentage = calculateReadinessFallbackPercentage({
    entryCount: entries.length,
    progress,
    stageProgress,
    clusterQuizResults: quizzes,
  });

  const notesBlock = additionalNotes
    ? `Instructor / additional notes (HIGH PRIORITY - topics mentioned here should be prioritized):\n${truncateToTokenLimit(String(additionalNotes), 2000)}\n`
    : "";
  const clusterQuizBlock = quizzes.length > 0
    ? `Cluster Quiz Results (IMPORTANT - these demonstrate actual test performance on topic clusters):\n${
        quizzes.map((q: any) =>
          `- ${q.category}: ${q.score}% (${q.passed ? "PASSED" : "FAILED"}) - ${q.questionCount} questions`
        ).join("\n")
      }\n\nAverage quiz score: ${Math.round(avgQuizScore)}% | Clusters passed: ${passedClusters}/${totalClusters}\n`
    : "";
  const stageProgressBlock = stageProgress
    ? `Depth stage progress (IMPORTANT - "why" carries the highest partial-readiness weight after recall):
- Completed depth stages: ${stageProgress.completedDepthStages ?? 0}/${stageProgress.totalDepthStages ?? 0}
- Average weighted topic completion: ${Math.round((Number(stageProgress.averageWeightedCompletion) || 0) * 100)}%
- Completion weights: recall 25%, why 40%, apply 15%, transfer 10%, teach-back 10%
- Anchor: if recall and why are completed across all topics, readiness should be clearly above 50% (around 65%) even before final topic pass.
Per-topic depth progress:
${
        Array.isArray(stageProgress.topics)
          ? stageProgress.topics.map((topic: any) => {
              const stages = Array.isArray(topic.completedStages) && topic.completedStages.length > 0
                ? topic.completedStages.join(", ")
                : "none";
              return `- ${topic.title}: ${Math.round((Number(topic.weightedCompletion) || 0) * 100)}% weighted completion; completed stages: ${stages}`;
            }).join("\n")
          : "No per-topic stage details provided."
      }\n`
    : "";

  const enhancedPlanSummary = entries
    .map((entry: any, idx: number) => {
      const status = (entry.status ?? "not_started").replace("_", " ");
      const examTag = entry.fromExamSource
        ? " [EXAM TOPIC]"
        : (entry.examRelevance === "high" ? " [LIKELY EXAM]" : "");
      const notesTag = entry.mentionedInNotes ? " [PROF FOCUS]" : "";
      return `${idx + 1}. ${entry.title}${examTag}${notesTag} [${entry.importanceTier ?? "core"} | priority ${
        entry.priorityScore ?? 0
      } | status ${status}${entry.category ? ` | ${entry.category}` : ""}]`;
    })
    .join("\n");

  const prompt = `You are an exam readiness coach. Given a study plan with progress and cluster quiz results, estimate a single readiness percentage (0-100) that maps to a German university grade and create a focused roadmap.

German Grading Scale (for reference):
- 85.5-100%: Grade 1.0 (Excellent)
- 81-85.4%: Grade 1.3 (Very Good)
- 76.5-80.9%: Grade 1.7 (Very Good)
- 72-76.4%: Grade 2.0 (Good)
- 67.5-71.9%: Grade 2.3 (Good)
- 63-67.4%: Grade 2.7 (Satisfactory)
- 58.5-62.9%: Grade 3.0 (Satisfactory)
- 54-58.4%: Grade 3.3 (Sufficient)
- 49.5-53.9%: Grade 3.7 (Sufficient)
- 45-49.4%: Grade 4.0 (Adequate - minimum pass)
- Below 45%: Failed

Progress counts:
- Passed: ${progress.passed ?? 0}
- In progress: ${progress.inProgress ?? 0}
- Not started: ${progress.notStarted ?? 0}
- Failed: ${progress.failed ?? 0}
- Total sections: ${entries.length}

Study plan entries (note: [EXAM TOPIC] = from past exam, [LIKELY EXAM] = high exam relevance, [PROF FOCUS] = mentioned in instructor notes):
${enhancedPlanSummary || "No plan entries provided."}

${clusterQuizBlock}${stageProgressBlock}${notesBlock}

IMPORTANT:
- Estimate a realistic readiness percentage based on progress, quiz scores, and topic coverage
- Items marked [EXAM TOPIC], [LIKELY EXAM], or [PROF FOCUS] are critical for exam success
- CLUSTER QUIZ RESULTS are strong indicators of actual exam performance
- WHY-stage completion is a strong readiness signal; recall+why across most topics should materially raise the percentage
- Be conservative - only give high percentages when most topics are passed

Return JSON ONLY with this shape:
{
  "readinessPercentage": 0-100,
  "summary": "1-2 sentence overview of exam readiness",
  "priorityExplanation": "2-3 sentences explaining WHY items are ordered this way, what factors drove the prioritization",
  "focusAreas": ["short bullets to improve next"],
  "roadmap": [
    {
      "order": 1,
      "title": "Topic or cluster",
      "action": "Specific next actions (1-2 sentences)",
      "reason": "Why this specific topic is prioritized at this position",
      "category": "Category name",
      "estimatedMinutes": 20-90,
      "examTopics": ["list of exam-related topics covered here, if any"]
    }
  ]
}

Rules:
- Put critical/weak topics first, then reinforcement, then polish.
- Prioritize items from past exams and instructor notes FIRST.
- Clusters with FAILED quizzes need extra focus in the roadmap.
- Keep roadmap to 5-8 steps max.
- Each roadmap item's "reason" should explain why it's at that priority position.`;

  const chat = await callChat([{ type: "text", text: prompt }], {
    aiSettings,
    useCase: "readiness_roadmap",
  });

  let parsed: any = null;
  try {
    parsed = JSON.parse(stripCodeFences(chat.message));
  } catch (err) {
    console.warn("[process-job][readiness_roadmap] parse failed, using fallback", err);
  }

  const clampPercent = (value: any, fallback: number) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : fallback;
  };

  const readinessPercentage = clampPercent(parsed?.readinessPercentage, fallbackPercentage);
  const readiness = {
    percentage: readinessPercentage,
    predictedGrade: percentageToGrade(readinessPercentage),
    summary: parsed?.summary || "AI-estimated readiness based on current progress.",
    focusAreas: Array.isArray(parsed?.focusAreas)
      ? parsed.focusAreas.filter(Boolean).map((f: any) => String(f))
      : ["Focus on core topics first, then high-yield, then stretch."],
    priorityExplanation: parsed?.priorityExplanation || undefined,
    updatedAt: new Date().toISOString(),
  };

  const roadmapSource = Array.isArray(parsed?.roadmap) ? parsed.roadmap : [];
  const fallbackRoadmap = entries.slice(0, 6).map((entry: any, idx: number) => ({
    order: idx + 1,
    title: entry.title,
    action: entry.description || "Study this topic and practice 2-3 questions.",
    reason: "Derived from study plan priority.",
    category: entry.category,
    estimatedMinutes: 45,
  }));

  const roadmap = roadmapSource.length > 0
    ? roadmapSource.map((step: any, idx: number) => ({
        order: typeof step.order === "number" ? step.order : idx + 1,
        title: step.title || `Step ${idx + 1}`,
        action: step.action || step.next || "Review and practice.",
        reason: step.reason || step.rationale || undefined,
        category: step.category || step.section || undefined,
        estimatedMinutes: Number.isFinite(Number(step.estimatedMinutes))
          ? Math.max(10, Math.min(180, Math.round(Number(step.estimatedMinutes))))
          : undefined,
        examTopics: Array.isArray(step.examTopics)
          ? step.examTopics.filter(Boolean).map((t: any) => String(t))
          : undefined,
      }))
    : fallbackRoadmap;

  return {
    result: { readiness, roadmap },
    usage: {
      feature: "readiness_roadmap",
      model: chat.model ?? null,
      usage: chat.usage,
      costUsd: chat.costUsd,
      inputCostUsd: chat.inputCostUsd,
      outputCostUsd: chat.outputCostUsd,
      lectureId: payload?.lectureId ?? payload?.lecture_id ?? null,
      metadata: { roadmapSteps: roadmap.length },
    },
  };
};

const summarizeFeedback = (feedback: any) => {
  if (!feedback || typeof feedback !== "object") return "";
  const parts = [
    feedback.summary,
    Array.isArray(feedback.whatWentWrong) ? `Went wrong: ${feedback.whatWentWrong.join("; ")}` : "",
    Array.isArray(feedback.improvements) ? `Improve: ${feedback.improvements.join("; ")}` : "",
    Array.isArray(feedback.misconceptions) ? `Misconceptions: ${feedback.misconceptions.join("; ")}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
};

const handleCheatSheet = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const { lectureId, language = "en", force = false } = payload ?? {};
  if (!lectureId) throw new Error("lectureId is required");
  if (!userId) throw new Error("User is required");

  const { data: lecture, error: lectureError } = await supabase
    .from("lectures")
    .select("id,title")
    .eq("id", lectureId)
    .single();
  if (lectureError) throw lectureError;

  const { data: sheet, error: sheetError } = await supabase
    .from("lecture_cheat_sheets")
    .select()
    .eq("lecture_id", lectureId)
    .maybeSingle();
  if (sheetError) throw sheetError;

  if (!sheet?.enabled && !force) {
    return {
      result: { skipped: true, reason: "disabled" },
      usage: { feature: "cheat_sheet", lectureId, metadata: { skipped: "disabled" } },
    };
  }

  await supabase
    .from("lecture_cheat_sheets")
    .upsert(
      {
        lecture_id: lectureId,
        user_id: userId,
        enabled: sheet?.enabled ?? true,
        status: "pending",
        error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lecture_id" },
    );

  const [
    { data: evaluations, error: evaluationsError },
    { data: depthChecks, error: depthChecksError },
    { data: misconceptions, error: misconceptionsError },
    { data: planEntries, error: planEntriesError },
  ] = await Promise.all([
    supabase
      .from("tutor_answer_evaluations")
      .select("*, study_plan_entries(title, priority_score, exam_relevance, from_exam_source, mentioned_in_notes)")
      .eq("lecture_id", lectureId)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("study_depth_checks")
      .select("*, study_plan_entries(title, priority_score, exam_relevance, from_exam_source, mentioned_in_notes)")
      .eq("lecture_id", lectureId)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("study_misconceptions")
      .select("*, study_plan_entries(title, priority_score, exam_relevance, from_exam_source, mentioned_in_notes)")
      .eq("lecture_id", lectureId)
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("study_plan_entries")
      .select("id,title,priority_score,exam_relevance,from_exam_source,mentioned_in_notes,status,status_score")
      .eq("lecture_id", lectureId),
  ]);

  if (evaluationsError && evaluationsError.code !== "42P01") throw evaluationsError;
  if (depthChecksError && depthChecksError.code !== "42P01") throw depthChecksError;
  if (misconceptionsError && misconceptionsError.code !== "42P01") throw misconceptionsError;
  if (planEntriesError && planEntriesError.code !== "42P01") throw planEntriesError;

  const evidenceItems = [
    ...((evaluationsError ? [] : evaluations) ?? []).map((item: any) => ({
      kind: "graded answer",
      topic: item.study_plan_entries?.title,
      priority: item.study_plan_entries?.priority_score,
      examRelevance: item.study_plan_entries?.exam_relevance,
      question: item.question_text,
      answer: item.answer_text,
      score: item.score,
      correctness: item.correctness,
      checkType: item.check_type,
      feedback: summarizeFeedback(item.feedback),
      misconceptions: Array.isArray(item.misconceptions) ? item.misconceptions : [],
      createdAt: item.created_at,
    })),
    ...((depthChecksError ? [] : depthChecks) ?? []).map((item: any) => ({
      kind: "depth check",
      topic: item.study_plan_entries?.title,
      priority: item.study_plan_entries?.priority_score,
      examRelevance: item.study_plan_entries?.exam_relevance,
      question: item.question_text,
      score: item.score,
      correctness: item.correctness,
      checkType: item.check_type,
      feedback: item.feedback_summary,
      misconceptions: [],
      createdAt: item.created_at,
    })),
    ...((misconceptionsError ? [] : misconceptions) ?? []).map((item: any) => ({
      kind: "unresolved misconception",
      topic: item.study_plan_entries?.title,
      priority: item.study_plan_entries?.priority_score,
      examRelevance: item.study_plan_entries?.exam_relevance,
      question: item.concept,
      feedback: item.note,
      score: 0,
      correctness: "misconception",
      misconceptions: [item.concept],
      createdAt: item.created_at,
    })),
  ];

  const planSignals = ((planEntriesError ? [] : planEntries) ?? [])
    .filter((entry: any) =>
      entry.status === "failed" ||
      (typeof entry.status_score === "number" && entry.status_score < 90) ||
      entry.exam_relevance === "high" ||
      entry.from_exam_source ||
      entry.mentioned_in_notes
    )
    .slice(0, 30)
    .map((entry: any) => ({
      title: entry.title,
      priority: entry.priority_score,
      examRelevance: entry.exam_relevance,
      status: entry.status,
      score: entry.status_score,
      fromExamSource: entry.from_exam_source,
      mentionedInNotes: entry.mentioned_in_notes,
    }));

  const sourceHash = hashText(JSON.stringify({ evidenceItems, planSignals }));
  const evidenceCount = evidenceItems.length;
  if (!force && sheet?.source_hash === sourceHash && sheet?.content) {
    await supabase
      .from("lecture_cheat_sheets")
      .update({
        status: "ready",
        error: null,
        evidence_count: evidenceCount,
        updated_at: new Date().toISOString(),
      })
      .eq("lecture_id", lectureId);
    return {
      result: { skipped: true, content: sheet.content },
      usage: { feature: "cheat_sheet", lectureId, metadata: { skipped: "unchanged", evidenceCount } },
    };
  }

  const weakEvidence = evidenceItems
    .filter((item: any) =>
      item.correctness !== "correct" ||
      (typeof item.score === "number" && item.score < 90) ||
      item.misconceptions.length > 0
    )
    .slice(0, 60);
  const evidenceSummary = truncateToTokenLimit(
    JSON.stringify({ weakEvidence, planSignals }, null, 2),
    20000,
  );

  let content: any = {
    title: `${lecture.title} Cheat Sheet`,
    summary: "No graded gaps have been recorded yet.",
    sections: [],
  };
  let chat: Awaited<ReturnType<typeof callChat>> | null = null;

  if (evidenceCount > 0) {
    chat = await callChat([{ type: "text", text: cheatSheetPrompt({
      lectureTitle: lecture.title,
      evidenceSummary,
      existingCheatSheet: sheet?.content ? JSON.stringify(sheet.content) : undefined,
      pageFormat: "Exactly one DIN A4 page with no more than 4 sections and 16 total items.",
    }, language) }], {
      aiSettings,
      useCase: "cheat_sheet",
    });

    try {
      content = JSON.parse(stripCodeFences(chat.message));
    } catch (error) {
      console.warn("[process-job][cheat_sheet] parse failed, using fallback", error);
      content = {
        title: `${lecture.title} Cheat Sheet`,
        summary: "Review the most recent weak answers and unresolved misconceptions.",
        sections: weakEvidence.slice(0, 4).map((item: any) => ({
          title: item.topic || item.checkType || "Focus area",
          items: [{
            title: item.misconceptions?.[0] || item.question || "Weak concept",
            gap: item.feedback || "The answer needs reinforcement.",
            fix: "Review the source explanation, then answer a similar tutor question from memory.",
            sourceQuestion: item.question,
            topicTitle: item.topic,
            priority: typeof item.score === "number" ? 100 - item.score : 80,
          }],
        })),
      };
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("lecture_cheat_sheets")
    .update({
      status: "ready",
      content,
      error: null,
      last_generated_at: now,
      evidence_count: evidenceCount,
      source_hash: sourceHash,
      updated_at: now,
    })
    .eq("lecture_id", lectureId);

  return {
    result: {
      content,
      evidenceCount,
      sourceHash,
    },
    usage: {
      feature: "cheat_sheet",
      model: chat?.model ?? null,
      usage: chat?.usage,
      costUsd: chat?.costUsd,
      inputCostUsd: chat?.inputCostUsd,
      outputCostUsd: chat?.outputCostUsd,
      lectureId,
      metadata: { evidenceCount },
    },
  };
};

const handleMetadata = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const { files = [], language = "en" } = payload ?? {};
  const summary = (files as Array<{ name: string; notes?: string }>)
    .map((f, idx) => `${idx + 1}. ${f.name}${f.notes ? ` — ${f.notes}` : ""}`)
    .join("\n");

  const prompt = lectureMetadataPrompt(summary || "No details provided.", language);
  const chat = await callChat([{ type: "text", text: prompt }], {
    aiSettings,
    useCase: "lecture_metadata",
  });

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

const handleChat = async (
  payload: any,
  aiSettings: UserAISettings,
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

  const reply = await callChatWithMessages(fullMessages as any, {
    aiSettings,
    useCase: "tutor_chat",
  });
  return {
    result: {
      message: reply.message,
      model: reply.model,
      platform: reply.platform,
      reasoningEffort: reply.reasoningEffort ?? null,
      usage: reply.usage,
    },
    usage: {
      feature: "chat",
      model: reply.model ?? null,
      usage: reply.usage,
      costUsd: reply.costUsd,
      inputCostUsd: reply.inputCostUsd,
      outputCostUsd: reply.outputCostUsd,
      lectureId: lectureId ?? null,
      metadata: {
        reasoningEffort: reply.reasoningEffort ?? null,
        reasoningTokens: reply.usage?.reasoningTokens ?? null,
      },
    },
  };
};

// Streaming chat handler that updates partial_result as tokens arrive
const handleChatStreaming = async (
  payload: any,
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  aiSettings: UserAISettings,
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

  const reply = await callChatWithMessagesStream(
    fullMessages as any,
    {
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
    },
    { aiSettings, useCase: "tutor_chat" },
  );

  return {
    result: {
      message: reply.message,
      model: reply.model,
      platform: reply.platform,
      reasoningEffort: reply.reasoningEffort ?? null,
      usage: reply.usage,
    },
    usage: {
      feature: "chat",
      model: reply.model ?? null,
      usage: reply.usage,
      costUsd: reply.costUsd,
      inputCostUsd: reply.inputCostUsd,
      outputCostUsd: reply.outputCostUsd,
      lectureId: lectureId ?? null,
      metadata: {
        reasoningEffort: reply.reasoningEffort ?? null,
        reasoningTokens: reply.usage?.reasoningTokens ?? null,
      },
    },
  };
};

const handleGrade = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const {
    question,
    answerText,
    answerImageDataUrl,
    answerCanvasBounds,
    language = "en",
    lectureId,
    gradingContext,
    passScoreThreshold,
  } = payload ?? {};
  if (!question || !question.prompt) {
    throw new Error("question.prompt is required");
  }

  const content: any[] = [
    {
      type: "text",
      text: gradingPrompt(
        question,
        answerText,
        language,
        gradingContext,
        answerCanvasBounds,
        passScoreThreshold,
      ),
    },
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

  const chat = await callChat(content, {
    aiSettings,
    useCase: "answer_grading",
  });

  let feedback: any = null;
  try {
    feedback = JSON.parse(stripCodeFences(chat.message));
  } catch {
    feedback = {
      summary: chat.message,
      correctness: "unknown",
    };
  }

  return {
    result: {
      model: chat.model,
      platform: chat.platform,
      reasoningEffort: chat.reasoningEffort ?? null,
      usage: chat.usage,
      feedback: {
          summary: feedback.summary ?? "No summary",
          correctness: feedback.correctness ?? "unknown",
          score: feedback.score ?? undefined,
          whatWentRight: Array.isArray(feedback.whatWentRight) ? feedback.whatWentRight : [],
          whatWentWrong: Array.isArray(feedback.whatWentWrong) ? feedback.whatWentWrong : [],
          correctAnswer: typeof feedback.correctAnswer === "string" ? feedback.correctAnswer : undefined,
          rewriteExample: typeof feedback.rewriteExample === "string" ? feedback.rewriteExample : undefined,
          improvements: Array.isArray(feedback.improvements) ? feedback.improvements : [],
          misconceptions: Array.isArray(feedback.misconceptions) ? feedback.misconceptions : [],
          followUpQuestion: typeof feedback.followUpQuestion === "string" ? feedback.followUpQuestion : undefined,
          sourceNotes: Array.isArray(feedback.sourceNotes) ? feedback.sourceNotes : [],
          sourceCitationIds: Array.isArray(feedback.sourceCitationIds)
            ? feedback.sourceCitationIds
                .map((id: unknown) => String(id ?? "").trim().toUpperCase())
                .filter((id: string) => /^S\d+$/.test(id))
            : [],
          checkType: typeof feedback.checkType === "string" ? feedback.checkType : undefined,
          canCountForPass: typeof feedback.canCountForPass === "boolean" ? feedback.canCountForPass : undefined,
          missingPrerequisites: Array.isArray(feedback.missingPrerequisites) ? feedback.missingPrerequisites : [],
          understandingLevel: typeof feedback.understandingLevel === "string" ? feedback.understandingLevel : undefined,
          rubric: feedback.rubric && typeof feedback.rubric === "object" ? feedback.rubric : undefined,
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

const handleEmbed = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const { inputs, lectureId } = payload ?? {};
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("inputs must be a non-empty array");
  }
  const embeddingResult = await embedTexts(inputs.map((i: any) => String(i)), {
    aiSettings,
    useCase: "embeddings",
  });
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

const handleTranscribe = async (
  payload: any,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  const { audioUrl, language = "en", durationSeconds, lectureId } = payload ?? {};
  if (!audioUrl) {
    throw new Error("audioUrl is required");
  }

  const provider = resolveAIProviderRequest("transcription", aiSettings);
  let file: File;

  if (String(audioUrl).startsWith("data:")) {
    const bytes = decodeDataUrl(String(audioUrl));
    const audioBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    file = new File([audioBuffer], "audio.m4a", { type: "audio/m4a" });
  } else {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    file = new File([arrayBuffer], "audio.m4a", { type: response.headers.get("content-type") ?? "audio/m4a" });
  }

  const response =
    provider.config.platform === "openrouter"
      ? await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
          method: "POST",
          headers: provider.headers,
          body: JSON.stringify({
            input_audio: {
              data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
              format: inferAudioFormat(file),
            },
            model: provider.config.model,
            language,
          }),
        })
      : await (() => {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("model", provider.config.model);
          formData.append("language", language);
          return fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${provider.apiKey}`,
            },
            body: formData,
          });
        })();

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${provider.config.platform} transcription failed: ${message}`);
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
      model: data?.model ?? provider.config.model,
      usage,
      costUsd: typeof data?.usage?.cost === "number" ? data.usage.cost : undefined,
      audioDurationSeconds,
      lectureId: lectureId ?? null,
      metadata: { language },
    },
  };
};

const runJob = async (
  job: Job,
  supabase: ReturnType<typeof createClient>,
  aiSettings: UserAISettings,
): Promise<JobRunResult> => {
  switch (job.type) {
    case "plan":
      return await handlePlan(job.payload, aiSettings);
    case "metadata":
      return await handleMetadata(job.payload, aiSettings);
    case "question_generation":
      return await handleQuestionGeneration(job.payload, aiSettings);
    case "readiness_roadmap":
      return await handleReadinessRoadmap(job.payload, aiSettings);
    case "cheat_sheet":
      return await handleCheatSheet(job.payload, supabase, job.user_id, aiSettings);
    case "chat":
      return await handleChat(job.payload, aiSettings);
    case "grade":
      return await handleGrade(job.payload, aiSettings);
    case "transcribe":
      return await handleTranscribe(job.payload, aiSettings);
    case "embed":
      return await handleEmbed(job.payload, aiSettings);
    case "practice_exam":
      return await handlePracticeExam(job.payload, supabase, job.user_id, aiSettings);
    case "lecture_pdf_reindex":
      return await handleLecturePdfReindex(job.payload, supabase, job.user_id, aiSettings);
    case "lecture_plan_v2":
      return await handleLecturePlanV2(job.payload, supabase, job.user_id, aiSettings);
    case "lecture_plan_inventory":
      return await handleLecturePlanInventory(job.payload, supabase, job.user_id, aiSettings);
    case "lecture_plan_synthesize":
      return await handleLecturePlanSynthesize(job.payload, supabase, job.user_id, aiSettings);
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

const processPlanJob = async (
  supabase: ReturnType<typeof createClient>,
  locked: Job,
  aiSettings: UserAISettings,
) => {
  setSentryJobContext(locked);
  try {
    console.log("[process-job] Background plan job started:", locked.id);
    const jobResult = await runJob(locked as Job, supabase, aiSettings);
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
    captureSentryException(jobError, {
      tags: { area: "process-job", job_type: locked.type },
      extra: { jobId: locked.id },
    });
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
    if (locked.type === "cheat_sheet") {
      const lectureId = locked.payload?.lectureId ?? locked.payload?.lecture_id;
      if (lectureId) {
        await supabase
          .from("lecture_cheat_sheets")
          .update({
            status: "failed",
            error: jobError?.message?.slice(0, 500) ?? "Cheat sheet generation failed",
            updated_at: new Date().toISOString(),
          })
          .eq("lecture_id", lectureId);
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

Deno.serve(withSentry("process-job", async (req: Request) => {
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

    setSentryJobContext(locked);
    console.log("[process-job] Processing job:", locked.id, "type:", locked.type);
    let result: any = null;

    try {
      const aiSettings = await loadUserAISettings(supabase, locked.user_id);
      if (
        locked.type === "plan" ||
        locked.type === "lecture_pdf_reindex" ||
        locked.type === "lecture_plan_v2" ||
        locked.type === "lecture_plan_synthesize"
      ) {
        console.log("[process-job] Scheduling background job:", locked.id);
        const backgroundPromise = processPlanJob(supabase, locked as Job, aiSettings);
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
        jobResult = await handleChatStreaming(locked.payload, supabase, locked.id, aiSettings);
      } else {
        jobResult = await runJob(locked as Job, supabase, aiSettings);
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
      captureSentryException(jobError, {
        tags: { area: "process-job", job_type: locked.type },
        extra: { jobId: locked.id },
      });
      const message = getErrorMessage(jobError, "Job failed");
      if (locked.type.startsWith("lecture_plan")) {
        const lectureId = locked.payload?.lectureId ?? locked.payload?.lecture_id;
        if (lectureId) {
          await supabase
            .from("lectures")
            .update({
              plan_status: "failed",
              plan_generated_at: null,
              plan_error: message.slice(0, 500),
            })
            .eq("id", lectureId);
        }
      }
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error: message.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", locked.id);
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ message: "job processed", id: locked.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[process-job] Error:", error);
    const message = getErrorMessage(error, "Failed to process job");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
