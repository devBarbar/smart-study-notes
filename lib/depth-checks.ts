import type {
  StudyDepthCheck,
  StudyFeedback,
  StudyPlanEntry,
  TutorCheckType,
  TutorQuestionDifficulty,
} from '@/types';

export const REQUIRED_TUTOR_CHECK_TYPES: TutorCheckType[] = [
  'recall',
  'why',
  'apply',
  'transfer',
  'teach_back',
];

export const DEPTH_PASS_SCORE = 90;

export const TUTOR_CHECK_LABELS: Record<TutorCheckType, string> = {
  recall: 'Recall',
  why: 'Why',
  apply: 'Apply',
  transfer: 'Transfer',
  teach_back: 'Teach-back',
};

export const TUTOR_CHECK_DESCRIPTIONS: Record<TutorCheckType, string> = {
  recall: 'state the core idea accurately',
  why: 'explain the reason or mechanism',
  apply: 'use it on a concrete problem',
  transfer: 'adapt it to a new situation',
  teach_back: 'teach it clearly in simple words',
};

const CHECK_TYPE_ALIASES: Record<string, TutorCheckType> = {
  recall: 'recall',
  definition: 'recall',
  define: 'recall',
  why: 'why',
  reasoning: 'why',
  mechanism: 'why',
  apply: 'apply',
  application: 'apply',
  problem: 'apply',
  transfer: 'transfer',
  edge: 'transfer',
  edge_case: 'transfer',
  teach: 'teach_back',
  teach_back: 'teach_back',
  teachback: 'teach_back',
  feynman: 'teach_back',
};

export const normalizeTutorCheckType = (
  value: unknown,
  fallback: TutorCheckType = 'recall',
): TutorCheckType => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return CHECK_TYPE_ALIASES[normalized] ?? fallback;
};

export const normalizeTutorQuestionDifficulty = (
  value: unknown,
): TutorQuestionDifficulty | undefined => {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'basic' || normalized === 'exam' || normalized === 'edge_case') {
    return normalized;
  }
  return undefined;
};

export const getPassedDepthCheckTypes = (
  checks: StudyDepthCheck[],
): Set<TutorCheckType> =>
  new Set(
    checks
      .filter(
        (check) =>
          check.passed &&
          check.canCountForPass &&
          typeof check.score === 'number' &&
          check.score >= DEPTH_PASS_SCORE,
      )
      .map((check) => normalizeTutorCheckType(check.checkType)),
  );

export const getNextTutorCheckType = (
  checks: StudyDepthCheck[],
): TutorCheckType | null => {
  const passedTypes = getPassedDepthCheckTypes(checks);
  return REQUIRED_TUTOR_CHECK_TYPES.find((type) => !passedTypes.has(type)) ?? null;
};

export const canPassStudyPlanEntry = (checks: StudyDepthCheck[]): boolean => {
  const passedTypes = getPassedDepthCheckTypes(checks);
  return REQUIRED_TUTOR_CHECK_TYPES.every((type) => passedTypes.has(type));
};

export const getDepthProgressCount = (checks: StudyDepthCheck[]) =>
  getPassedDepthCheckTypes(checks).size;

export const feedbackPassesDepthCheck = (feedback: StudyFeedback): boolean => {
  const scorePassed = typeof feedback.score === 'number' && feedback.score >= DEPTH_PASS_SCORE;
  return scorePassed && feedback.canCountForPass !== false;
};

export const buildDepthCheckProgressLine = (checks: StudyDepthCheck[]) => {
  const passed = getPassedDepthCheckTypes(checks);
  return REQUIRED_TUTOR_CHECK_TYPES
    .map((type) => `${TUTOR_CHECK_LABELS[type]} ${passed.has(type) ? 'done' : 'open'}`)
    .join(' | ');
};

export const buildDepthQuestion = (
  checkType: TutorCheckType,
  entry: Pick<StudyPlanEntry, 'title' | 'description' | 'keyConcepts' | 'learningObjective'>,
): string => {
  const concepts = entry.keyConcepts?.filter(Boolean).slice(0, 4) ?? [];
  const conceptText = concepts.length > 0 ? concepts.join(', ') : 'the main concepts';
  const objective = entry.learningObjective || entry.description || entry.title;

  switch (checkType) {
    case 'recall':
      return `Without looking back, what is the core idea of "${entry.title}" and which parts of ${conceptText} matter most?`;
    case 'why':
      return `Why does "${entry.title}" work this way? Explain the mechanism or reasoning behind ${conceptText}.`;
    case 'apply':
      return `Apply "${entry.title}" to one concrete example or problem from the material. Show the steps you would use.`;
    case 'transfer':
      return `How would "${entry.title}" change in a new or edge-case situation? Give a different example and explain what still stays true.`;
    case 'teach_back':
      return `Teach "${entry.title}" to a friend in simple words. Include the goal: ${objective}.`;
    default:
      return `Explain "${entry.title}" in your own words.`;
  }
};
