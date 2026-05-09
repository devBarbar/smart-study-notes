import { TutorQuestionMetadata } from '@/types';

const LEARNING_QUESTION_REGEX = /```learning_question\s*\n([\s\S]*?)\n```/g;

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

  return {
    question,
    targetConcepts: toStringList(data.targetConcepts),
    expectedAnswerPoints: toStringList(data.expectedAnswerPoints),
  };
};

export const parseLearningResponse = (rawText: string): ParsedLearningResponse => {
  if (!rawText) return { text: '' };

  const matches: { fullMatch: string; json: string }[] = [];
  LEARNING_QUESTION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LEARNING_QUESTION_REGEX.exec(rawText)) !== null) {
    matches.push({ fullMatch: match[0], json: match[1].trim() });
  }

  let tutorQuestion: TutorQuestionMetadata | undefined;
  for (const { json } of matches) {
    try {
      tutorQuestion = normalizeTutorQuestion(JSON.parse(json)) ?? tutorQuestion;
    } catch {
      // Ignore malformed metadata; visible response text still renders.
    }
  }

  let cleanText = rawText;
  for (const { fullMatch } of matches) {
    cleanText = cleanText.replace(fullMatch, '');
  }

  return {
    text: cleanText.replace(/\n{3,}/g, '\n\n').trim(),
    tutorQuestion,
  };
};
