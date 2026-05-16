import type { TutorQuestionMetadata } from '@/types';
import { normalizeTutorCheckType, normalizeTutorQuestionDifficulty } from './depth-checks';

const FENCED_BLOCK_REGEX = /```[ \t]*([^\n`]*)\n([\s\S]*?)(?:\n?```|$)/g;
const TRAILING_JSON_MIN_KEYS = ['"question"', '"checkType"'];

type ParsedLearningResponse = {
  text: string;
  tutorQuestion?: TutorQuestionMetadata;
};

const toStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

const normalizeTutorQuestion = (value: unknown): TutorQuestionMetadata | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const question = String(data.question ?? '').trim();
  if (!question) return undefined;
  const assessmentKind =
    data.assessmentKind === 'final_quiz'
      ? 'final_quiz'
      : data.assessmentKind === 'guided_notes'
        ? 'guided_notes'
      : data.assessmentKind === 'depth'
        ? 'depth'
        : undefined;

  return {
    question,
    targetConcepts: toStringList(data.targetConcepts),
    expectedAnswerPoints: toStringList(data.expectedAnswerPoints),
    checkType: normalizeTutorCheckType(data.checkType),
    requiredForPass: data.requiredForPass === undefined ? true : Boolean(data.requiredForPass),
    difficulty: normalizeTutorQuestionDifficulty(data.difficulty),
    ...(assessmentKind ? { assessmentKind } : {}),
  };
};

const parseTutorQuestionJson = (raw: string): TutorQuestionMetadata | undefined => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  try {
    return normalizeTutorQuestion(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return undefined;
  }
};

const findTrailingTutorQuestionJson = (
  text: string,
): { fullMatch: string; tutorQuestion: TutorQuestionMetadata } | undefined => {
  const trimmedEnd = text.trimEnd();
  if (!TRAILING_JSON_MIN_KEYS.every((key) => trimmedEnd.includes(key))) {
    return undefined;
  }

  let searchIndex = trimmedEnd.lastIndexOf('{');
  while (searchIndex !== -1) {
    const candidate = trimmedEnd.slice(searchIndex).trim();
    const tutorQuestion = parseTutorQuestionJson(candidate);
    if (tutorQuestion) {
      return { fullMatch: text.slice(searchIndex), tutorQuestion };
    }
    searchIndex = trimmedEnd.lastIndexOf('{', searchIndex - 1);
  }

  return undefined;
};

export const parseLearningResponse = (rawText: string): ParsedLearningResponse => {
  if (!rawText) return { text: '' };

  const matches: { fullMatch: string; tutorQuestion?: TutorQuestionMetadata }[] = [];
  FENCED_BLOCK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  let tutorQuestion: TutorQuestionMetadata | undefined;

  while ((match = FENCED_BLOCK_REGEX.exec(rawText)) !== null) {
    const label = match[1].trim().toLowerCase();
    const body = match[2].trim();
    const isLearningQuestionBlock = label.startsWith('learning_question');
    const isJsonBlock = label === 'json';
    if (!isLearningQuestionBlock && !isJsonBlock) {
      continue;
    }

    const parsed = parseTutorQuestionJson(body);
    if (parsed) {
      tutorQuestion = parsed;
    }

    if (parsed || isLearningQuestionBlock) {
      matches.push({ fullMatch: match[0], tutorQuestion: parsed });
    }
  }

  let cleanText = rawText;
  for (const { fullMatch, tutorQuestion: parsed } of matches) {
    if (parsed) {
      tutorQuestion = parsed;
    }
    cleanText = cleanText.replace(fullMatch, '');
  }

  const trailingJson = findTrailingTutorQuestionJson(cleanText);
  if (trailingJson) {
    tutorQuestion = trailingJson.tutorQuestion;
    cleanText = cleanText.replace(trailingJson.fullMatch, '');
  }

  return {
    text: cleanText.replace(/\n{3,}/g, '\n\n').trim(),
    tutorQuestion,
  };
};
