const SOURCE_ID_PATTERN = /\bS\d+\b/gi;
const SOURCE_CITATION_FENCE_PATTERN = /```source_citations\s*([\s\S]*?)```/gi;
const INLINE_SOURCE_MARKER_PATTERN = /\s*\[(S\d+(?:\s*,\s*S\d+)*)\]/gi;

const normalizeSourceIds = (ids: Iterable<string>) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of ids) {
    const sourceId = String(id ?? "").trim().toUpperCase();
    if (!/^S\d+$/.test(sourceId) || seen.has(sourceId)) continue;
    seen.add(sourceId);
    normalized.push(sourceId);
  }

  return normalized;
};

const extractSourceIdsFromBlock = (block: string) => {
  const trimmed = block.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return normalizeSourceIds(parsed);
    if (Array.isArray(parsed?.sourceIds)) return normalizeSourceIds(parsed.sourceIds);
    if (Array.isArray(parsed?.sources)) return normalizeSourceIds(parsed.sources);
  } catch {
    // Fall back to scanning the block so a slightly malformed fence still works.
  }

  return normalizeSourceIds(trimmed.match(SOURCE_ID_PATTERN) ?? []);
};

export const parseSourceCitations = (text: string) => {
  const sourceIds: string[] = [];
  let cleanedText = String(text ?? "").replace(
    SOURCE_CITATION_FENCE_PATTERN,
    (_match, block) => {
      sourceIds.push(...extractSourceIdsFromBlock(block));
      return "";
    },
  );
  cleanedText = cleanedText.replace(/```source_citations[\s\S]*$/i, "");

  cleanedText = cleanedText.replace(INLINE_SOURCE_MARKER_PATTERN, (_match, ids) => {
    sourceIds.push(...(String(ids).match(SOURCE_ID_PATTERN) ?? []));
    return "";
  });

  return {
    text: cleanedText.replace(/\n{3,}/g, "\n\n").trim(),
    sourceIds: normalizeSourceIds(sourceIds),
  };
};
