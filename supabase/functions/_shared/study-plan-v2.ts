export type PlanSettings = {
  examDate?: string;
  targetGrade?: string;
  weeklyStudyMinutes?: number;
  preferredSessionMinutes?: number;
  currentLevel?: "beginner" | "some-background" | "advanced";
  weakAreas?: string[];
  additionalNotes?: string;
};

export type SourceRef = {
  fileName?: string;
  pageNumber?: number;
  reason?: string;
};

export type ParsedPlanModule = {
  clientId: string;
  title: string;
  summary?: string;
  orderIndex: number;
  estimatedMinutes?: number;
};

export type ParsedPlanEntry = {
  clientId: string;
  moduleClientId: string;
  title: string;
  description?: string;
  keyConcepts: string[];
  category?: string;
  importanceTier: "core" | "high-yield" | "stretch";
  priorityScore: number;
  orderIndex: number;
  fromExamSource?: boolean;
  examRelevance?: "high" | "medium" | "low";
  mentionedInNotes?: boolean;
  prerequisiteClientIds: string[];
  prerequisiteEntryIds?: string[];
  learningObjective?: string;
  estimatedMinutes?: number;
  difficulty?: "intro" | "core" | "advanced";
  sequenceReason?: string;
  sourceRefs?: SourceRef[];
};

export type ParsedLearningPath = {
  modules: ParsedPlanModule[];
  entries: ParsedPlanEntry[];
  warnings: string[];
};

export type LearningPathPromptOptions = {
  sourceFiles?: string[];
  sourceCoverageRequirements?: SourceCoverageGap[];
  minEntries?: number;
  maxEntries?: number;
  minModules?: number;
  maxModules?: number;
};

export type SourceCoverageInput = {
  fileName: string;
  textLength?: number;
  isExam?: boolean;
};

export type SourceCoverageGap = {
  fileName: string;
  currentRefs: number;
  requiredRefs: number;
  reason: string;
};

const defaultPriority: Record<ParsedPlanEntry["importanceTier"], number> = {
  core: 90,
  "high-yield": 70,
  stretch: 40,
};

const sanitizeForDatabase = (text: string): string =>
  text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();

const stripCodeFences = (text: string) => {
  const fenceMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
};

const tierOrder: Record<ParsedPlanEntry["importanceTier"], number> = {
  core: 0,
  "high-yield": 1,
  stretch: 2,
};

const difficultyOrder: Record<NonNullable<ParsedPlanEntry["difficulty"]>, number> = {
  intro: 0,
  core: 1,
  advanced: 2,
};

const normalizeTier = (value: unknown): ParsedPlanEntry["importanceTier"] => {
  const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (normalized === "high-yield" || normalized === "high yield") return "high-yield";
  if (normalized === "stretch") return "stretch";
  return "core";
};

const normalizeExamRelevance = (value: unknown): ParsedPlanEntry["examRelevance"] | undefined => {
  const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return undefined;
};

const normalizeDifficulty = (value: unknown): ParsedPlanEntry["difficulty"] => {
  const normalized = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (normalized === "advanced") return "advanced";
  if (normalized === "intro" || normalized === "beginner") return "intro";
  return "core";
};

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];

const sourceRefs = (value: unknown): SourceRef[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const refs: SourceRef[] = [];
  value.forEach((item) => {
      if (!item || typeof item !== "object") return null;
      const ref = item as Record<string, unknown>;
      const normalized: SourceRef = {
        fileName: ref.fileName ? String(ref.fileName) : undefined,
        pageNumber: Number.isFinite(Number(ref.pageNumber)) ? Number(ref.pageNumber) : undefined,
        reason: ref.reason ? String(ref.reason) : undefined,
      };
      if (normalized.fileName || normalized.reason) refs.push(normalized);
      return null;
    });
  return refs.length > 0 ? refs : undefined;
};

const isPracticeSource = (fileName: string) =>
  /\b(exam|mock|practice|exercise|sheet|solution|aufgabe|klausur|probe)\b/i.test(fileName);

export const requiredSourceReferenceCount = (source: SourceCoverageInput): number => {
  const length = Math.max(0, Number(source.textLength ?? 0));
  if (source.isExam || isPracticeSource(source.fileName)) return 2;
  if (length >= 60000) return 3;
  if (length >= 20000) return 2;
  return 1;
};

export const sourceReferenceCounts = (
  parsedPath: Pick<ParsedLearningPath, "entries">,
): Map<string, number> => {
  const counts = new Map<string, number>();
  parsedPath.entries.forEach((entry) => {
    const filesForEntry = new Set<string>();
    (entry.sourceRefs ?? []).forEach((ref) => {
      const fileName = typeof ref.fileName === "string" ? ref.fileName.trim().toLowerCase() : "";
      if (fileName) filesForEntry.add(fileName);
    });
    filesForEntry.forEach((fileName) => counts.set(fileName, (counts.get(fileName) ?? 0) + 1));
  });
  return counts;
};

export const findUndercoveredSources = (
  parsedPath: Pick<ParsedLearningPath, "entries">,
  sources: SourceCoverageInput[],
): SourceCoverageGap[] => {
  const counts = sourceReferenceCounts(parsedPath);
  return sources
    .map((source) => {
      const requiredRefs = requiredSourceReferenceCount(source);
      const currentRefs = counts.get(source.fileName.trim().toLowerCase()) ?? 0;
      if (currentRefs >= requiredRefs) return null;
      const reason = source.isExam || isPracticeSource(source.fileName)
        ? "practice or exam material needs dedicated review coverage"
        : (source.textLength ?? 0) >= 60000
          ? "large source needs multiple focused sessions"
          : (source.textLength ?? 0) >= 20000
            ? "substantial source needs more than one focused session"
            : "source must be represented";
      return {
        fileName: source.fileName,
        currentRefs,
        requiredRefs,
        reason,
      };
    })
    .filter((gap): gap is SourceCoverageGap => Boolean(gap));
};

export const buildConceptInventoryPrompt = (
  materialContent: string,
  planSettings: PlanSettings,
  language = "en",
) => `You are designing a prerequisite-aware learning path from lecture materials.

Student setup:
${JSON.stringify(planSettings, null, 2)}

Materials:
${materialContent}

Extract a concise concept inventory. Identify prerequisites, weak-area matches, professor-note matches, past-exam signals, and source references.

Return JSON only:
{
  "concepts": [
    {
      "id": "stable-kebab-id",
      "title": "Concept title",
      "summary": "Why it matters",
      "prerequisites": ["concept-id"],
      "keyConcepts": ["term"],
      "difficulty": "intro | core | advanced",
      "fromExamSource": true,
      "examRelevance": "high | medium | low",
      "mentionedInNotes": true,
      "sourceRefs": [{"fileName":"name.pdf","pageNumber":1,"reason":"short evidence"}]
    }
  ]
}

Keep only teachable concepts that matter for a study path. Aim for 8-14 concepts for this material batch, merging repeated ideas instead of listing every slide detail. Respond in ${language} but keep JSON keys in English.`;

export const buildLearningPathPrompt = (
  conceptInventory: string,
  planSettings: PlanSettings,
  language = "en",
  options: LearningPathPromptOptions = {},
) => `You are creating a module-based study path optimized for learning flow.

Student setup:
${JSON.stringify(planSettings, null, 2)}

Uploaded source files that must be represented in the final plan:
${(options.sourceFiles ?? []).map((fileName) => `- ${fileName}`).join("\n") || "- Not provided"}

Minimum source coverage requirements:
${(options.sourceCoverageRequirements ?? []).map((gap) => `- ${gap.fileName}: at least ${gap.requiredRefs} distinct entries because ${gap.reason}.`).join("\n") || "- Every uploaded file needs at least one sourceRefs entry."}

Concept inventory:
${conceptInventory}

Create ordered modules and session-sized study entries. Prerequisites must appear before dependent topics, even when dependent topics are exam-relevant. Prefer ${planSettings.preferredSessionMinutes ?? 45}-minute sessions.

Return JSON only:
{
  "modules": [
    {
      "id": "module-id",
      "title": "Module title",
      "summary": "What this module unlocks",
      "estimatedMinutes": 90
    }
  ],
  "entries": [
    {
      "id": "entry-id",
      "moduleId": "module-id",
      "title": "Session title",
      "description": "What to study",
      "learningObjective": "By the end, the student can...",
      "keyConcepts": ["term"],
      "category": "Module/category name",
      "importanceTier": "core | high-yield | stretch",
      "priorityScore": 0,
      "difficulty": "intro | core | advanced",
      "estimatedMinutes": 45,
      "prerequisites": ["entry-id"],
      "sequenceReason": "Why this comes now",
      "fromExamSource": true,
      "examRelevance": "high | medium | low",
      "mentionedInNotes": true,
      "sourceRefs": [{"fileName":"name.pdf","pageNumber":1,"reason":"short evidence"}]
    }
  ]
}

Rules:
- Build ${options.minModules ?? 6}-${options.maxModules ?? 10} modules and ${options.minEntries ?? 28}-${options.maxEntries ?? 45} entries for broad multi-PDF lectures.
- Each entry is one focused study session.
- For exam files, create dedicated practice/review sessions instead of only folding exam signals into concept sessions.
- Every uploaded source file listed above must appear at least once in sourceRefs using the exact fileName.
- Files listed under minimum source coverage requirements must appear in at least that many distinct entries; create or split sessions for their distinct teachable concepts instead of attaching sourceRefs to unrelated broad sessions.
- Use more than one sourceRef on an entry when a session synthesizes related material across multiple files.
- Sort by prerequisites first, then setup weak areas, then exam/professor signal, then difficulty.
- Include sequenceReason for every entry.
- Respond in ${language} but keep JSON keys in English.`;

export const parseLearningPath = (rawText: string): ParsedLearningPath => {
  const warnings: string[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch {
    warnings.push("AI response was not valid JSON; used fallback learning path.");
    return fallbackLearningPath(warnings);
  }

  const rawModules = Array.isArray(parsed?.modules) ? parsed.modules : [];
  const rawEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  if (rawModules.length === 0 || rawEntries.length === 0) {
    warnings.push("AI response missed modules or entries; used fallback learning path.");
    return fallbackLearningPath(warnings);
  }

  const modules: ParsedPlanModule[] = rawModules.map((module: any, index: number) => {
    const clientId = String(module?.id || `module-${index + 1}`).trim();
    return {
      clientId,
      title: sanitizeForDatabase(String(module?.title || `Module ${index + 1}`)),
      summary: module?.summary ? sanitizeForDatabase(String(module.summary)) : undefined,
      orderIndex: index,
      estimatedMinutes: module?.estimatedMinutes
        ? clampInt(module.estimatedMinutes, 90, 15, 2000)
        : undefined,
    };
  });

  const moduleIds = new Set(modules.map((module) => module.clientId));
  const seenTitles = new Set<string>();
  const entries: ParsedPlanEntry[] = [];

  rawEntries.forEach((item: any, index: number) => {
    const title = sanitizeForDatabase(String(item?.title || `Topic ${index + 1}`));
    const normalizedTitle = title.toLowerCase();
    if (seenTitles.has(normalizedTitle)) return;
    seenTitles.add(normalizedTitle);

    const importanceTier = normalizeTier(item?.importanceTier);
    const moduleClientId = moduleIds.has(String(item?.moduleId))
      ? String(item.moduleId)
      : modules[Math.min(index, modules.length - 1)]?.clientId ?? modules[0].clientId;

    entries.push({
      clientId: String(item?.id || `entry-${index + 1}`).trim(),
      moduleClientId,
      title,
      description: item?.description ? sanitizeForDatabase(String(item.description)) : undefined,
      learningObjective: item?.learningObjective ? sanitizeForDatabase(String(item.learningObjective)) : undefined,
      keyConcepts: stringArray(item?.keyConcepts),
      category: item?.category ? sanitizeForDatabase(String(item.category)) : modules.find((m) => m.clientId === moduleClientId)?.title,
      importanceTier,
      priorityScore: clampInt(item?.priorityScore, defaultPriority[importanceTier], 0, 100),
      orderIndex: index,
      fromExamSource: item?.fromExamSource === true,
      examRelevance: normalizeExamRelevance(item?.examRelevance),
      mentionedInNotes: item?.mentionedInNotes === true,
      prerequisiteClientIds: stringArray(item?.prerequisites),
      estimatedMinutes: item?.estimatedMinutes ? clampInt(item.estimatedMinutes, 45, 10, 180) : undefined,
      difficulty: normalizeDifficulty(item?.difficulty),
      sequenceReason: item?.sequenceReason ? sanitizeForDatabase(String(item.sequenceReason)) : "Ordered to build prerequisite understanding before dependent topics.",
      sourceRefs: sourceRefs(item?.sourceRefs),
    });
  });

  if (entries.length === 0) {
    warnings.push("AI response contained only duplicate or invalid entries; used fallback learning path.");
    return fallbackLearningPath(warnings);
  }

  const sortedEntries = sortLearningPathEntries(entries);
  return {
    modules,
    entries: sortedEntries.map((entry, index) => ({ ...entry, orderIndex: index })),
    warnings,
  };
};

export const sortLearningPathEntries = (entries: ParsedPlanEntry[]): ParsedPlanEntry[] => {
  const byId = new Map(entries.map((entry) => [entry.clientId, entry]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  entries.forEach((entry) => {
    indegree.set(entry.clientId, 0);
    dependents.set(entry.clientId, []);
  });

  entries.forEach((entry) => {
    const validPrereqs = entry.prerequisiteClientIds.filter((id) => byId.has(id));
    entry.prerequisiteClientIds = validPrereqs;
    indegree.set(entry.clientId, validPrereqs.length);
    validPrereqs.forEach((id) => dependents.get(id)?.push(entry.clientId));
  });

  const score = (entry: ParsedPlanEntry) => {
    const weakSignal = entry.mentionedInNotes ? 25 : 0;
    const examSignal = (entry.fromExamSource ? 18 : 0) + (entry.examRelevance === "high" ? 12 : entry.examRelevance === "medium" ? 6 : 0);
    const tierSignal = (2 - tierOrder[entry.importanceTier]) * 8;
    const difficultySignal = 6 - difficultyOrder[entry.difficulty ?? "core"] * 3;
    return weakSignal + examSignal + tierSignal + difficultySignal + entry.priorityScore / 10;
  };

  const ready = entries.filter((entry) => (indegree.get(entry.clientId) ?? 0) === 0);
  const result: ParsedPlanEntry[] = [];

  while (ready.length > 0) {
    ready.sort((a, b) => score(b) - score(a) || a.orderIndex - b.orderIndex);
    const next = ready.shift()!;
    result.push(next);
    for (const dependentId of dependents.get(next.clientId) ?? []) {
      const nextDegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) ready.push(dependent);
      }
    }
  }

  if (result.length !== entries.length) {
    const included = new Set(result.map((entry) => entry.clientId));
    entries
      .filter((entry) => !included.has(entry.clientId))
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((entry) => result.push({ ...entry, prerequisiteClientIds: [] }));
  }

  return result;
};

const fallbackLearningPath = (warnings: string[] = []): ParsedLearningPath => ({
  warnings,
  modules: [
    {
      clientId: "module-foundations",
      title: "Foundations",
      summary: "Start with the core concepts that unlock the rest of the material.",
      orderIndex: 0,
      estimatedMinutes: 90,
    },
  ],
  entries: [
    {
      clientId: "entry-general-study",
      moduleClientId: "module-foundations",
      title: "General Study",
      description: "Review the uploaded lecture materials and identify the main definitions, procedures, and examples.",
      learningObjective: "Build a baseline understanding of the lecture before targeted practice.",
      keyConcepts: ["Review", "Definitions", "Practice"],
      category: "Foundations",
      importanceTier: "core",
      priorityScore: 90,
      orderIndex: 0,
      prerequisiteClientIds: [],
      estimatedMinutes: 45,
      difficulty: "intro",
      sequenceReason: "Fallback entry used because the generated learning path could not be parsed.",
    },
  ],
});
