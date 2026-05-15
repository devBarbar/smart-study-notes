export type PdfTextItemLike = {
  str?: string;
  transform?: number[];
};

export type PdfSourceLineChunk = {
  content: string;
  startLine: number;
  endLine: number;
};

export const groupPdfTextItemsIntoLines = (
  items: PdfTextItemLike[],
  yTolerance = 3,
): string[] => {
  const groups: { y: number; items: { x: number; text: string }[] }[] = [];

  items.forEach((item, fallbackIndex) => {
    const text = String(item.str ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;

    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number.isFinite(transform[4]) ? Number(transform[4]) : fallbackIndex;
    const y = Number.isFinite(transform[5]) ? Number(transform[5]) : -fallbackIndex;
    const group = groups.find((candidate) => Math.abs(candidate.y - y) <= yTolerance);

    if (group) {
      group.items.push({ x, text });
      group.y = (group.y + y) / 2;
    } else {
      groups.push({ y, items: [{ x, text }] });
    }
  });

  return groups
    .sort((a, b) => b.y - a.y)
    .map((group) =>
      group.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
};

export const splitTextIntoLineChunks = (
  text: string,
  maxChars = 1600,
  overlapChars = 200,
): PdfSourceLineChunk[] => {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, index) => ({ text: line.trim(), lineNumber: index + 1 }))
    .filter((line) => line.text.length > 0);

  if (lines.length === 0) return [];

  const chunks: PdfSourceLineChunk[] = [];
  let startIndex = 0;

  while (startIndex < lines.length) {
    let endIndex = startIndex;
    let length = 0;

    while (endIndex < lines.length) {
      const nextLength = length + lines[endIndex].text.length + (endIndex > startIndex ? 1 : 0);
      if (nextLength > maxChars && endIndex > startIndex) break;
      length = nextLength;
      endIndex += 1;
    }

    const chunkLines = lines.slice(startIndex, endIndex);
    chunks.push({
      content: chunkLines.map((line) => line.text).join("\n"),
      startLine: chunkLines[0].lineNumber,
      endLine: chunkLines[chunkLines.length - 1].lineNumber,
    });

    if (endIndex >= lines.length) break;

    let overlapStart = endIndex;
    let overlapLength = 0;
    while (overlapStart > startIndex) {
      const candidate = lines[overlapStart - 1];
      const nextLength = overlapLength + candidate.text.length + (overlapLength > 0 ? 1 : 0);
      if (nextLength > overlapChars) break;
      overlapLength = nextLength;
      overlapStart -= 1;
    }

    startIndex = Math.max(startIndex + 1, overlapStart);
  }

  return chunks;
};

export const buildCitationSnippet = (content: string, maxChars = 900): string => {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}...`;
};
