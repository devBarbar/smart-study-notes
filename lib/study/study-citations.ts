import { CanvasBounds, LectureFile, StudyCitation } from '../../types';
import { LectureFileChunk } from '../supabase';

export type CitationSourceType = NonNullable<StudyCitation['sourceType']>;

export type CitationSourceMetadata = {
  name: string;
  sourceType: CitationSourceType;
};

export type CitationSourceChunk = LectureFileChunk & {
  sourceId: string;
};

export const cleanSourceFileName = (nameOrUri: string) => {
  const withoutQuery = nameOrUri.split(/[?#]/)[0];
  const lastSegment = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? nameOrUri;
  let decoded = lastSegment;

  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    decoded = lastSegment;
  }

  const cleaned = decoded.replace(/\.(pdf|png|jpe?g|webp|heic|txt|docx?|pptx?|pages)$/i, '').trim();
  return cleaned || decoded;
};

const PRACTICE_SOURCE_PATTERN =
  /\b(exercise|sheet|worksheet|practice|assignment|aufgabe|uebung|übung)\b/i;
const EXAM_SOURCE_PATTERN = /\b(exam|mock|klausur|probe)\b/i;

export const getCitationSourceType = (file?: Pick<LectureFile, 'name' | 'uri' | 'isExam'>): CitationSourceType => {
  if (!file?.isExam) return 'lecture';

  const name = cleanSourceFileName(file.name || file.uri);
  if (PRACTICE_SOURCE_PATTERN.test(name) && !EXAM_SOURCE_PATTERN.test(name)) {
    return 'exercise';
  }

  return 'past_exam';
};

export const uniqueChunksBySourcePage = (chunks: LectureFileChunk[]) => {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    const key = `${chunk.lectureFileId}-${chunk.pageNumber ?? 'unknown'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const tokenizeForCitationOverlap = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß]+/i)
      .filter((word) => word.length >= 5),
  );

export const rankChunksByAnswerOverlap = (
  chunks: LectureFileChunk[],
  answerText?: string,
) => {
  if (!answerText?.trim()) return chunks;

  const answerTerms = tokenizeForCitationOverlap(answerText);
  if (answerTerms.size === 0) return chunks;

  const ranked = chunks
    .map((chunk, index) => {
      const chunkTerms = tokenizeForCitationOverlap(chunk.content);
      let overlap = 0;
      chunkTerms.forEach((term) => {
        if (answerTerms.has(term)) overlap += 1;
      });

      return {
        chunk,
        index,
        score: overlap * 10 + (chunk.similarity ?? 0),
      };
    })
    .filter((item) => item.score > (item.chunk.similarity ?? 0));

  if (ranked.length === 0) return chunks;

  const rankedIds = new Set(ranked.map((item) => item.chunk.id));
  return [
    ...ranked
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.chunk),
    ...chunks.filter((chunk) => !rankedIds.has(chunk.id)),
  ];
};

export const balanceCitationChunks = (
  chunks: LectureFileChunk[],
  maxCount = 6,
  answerText?: string,
) => {
  const uniqueChunks = uniqueChunksBySourcePage(
    rankChunksByAnswerOverlap(chunks, answerText),
  );
  const lectureChunks = uniqueChunks.filter(
    (chunk) => chunk.sourceType === 'lecture' || !chunk.sourceType,
  );
  const supportingChunks = uniqueChunks.filter(
    (chunk) => chunk.sourceType === 'exercise' || chunk.sourceType === 'past_exam',
  );
  const selected: LectureFileChunk[] = [];
  const addChunks = (sourceChunks: LectureFileChunk[], limit: number) => {
    for (const chunk of sourceChunks) {
      if (selected.length >= maxCount || limit <= 0) break;
      if (selected.some((existing) => existing.id === chunk.id)) continue;
      selected.push(chunk);
      limit -= 1;
    }
  };

  const lectureTarget = lectureChunks.length > 0 ? Math.min(4, maxCount) : 0;
  addChunks(lectureChunks, lectureTarget);
  addChunks(supportingChunks, maxCount - selected.length);
  addChunks(lectureChunks, maxCount - selected.length);
  addChunks(uniqueChunks, maxCount - selected.length);

  return selected;
};

export type CitationChunkWithBounds = LectureFileChunk & {
  sourceBBox?: CanvasBounds;
};
