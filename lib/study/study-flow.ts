import {
  StudyMistakeNotebookItem,
  StudyMode,
  StudyPrepContent,
  StudyQuestion,
  StudyWarmupQuestion,
} from '../../types';

import { FinalQuizAnswer, WarmupAnswer } from './study-session-types';

export const shuffleStudyWarmupOptions = (
  question: StudyWarmupQuestion,
): StudyWarmupQuestion => {
  const keyed = question.options.map((option, index) => ({
    option,
    isCorrect: index === question.correctOptionIndex,
  }));

  for (let index = keyed.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [keyed[index], keyed[swapIndex]] = [keyed[swapIndex], keyed[index]];
  }

  return {
    ...question,
    options: keyed.map((item) => item.option),
    correctOptionIndex: Math.max(0, keyed.findIndex((item) => item.isCorrect)),
  };
};

const TECHNICAL_TOPIC_PATTERN =
  /\b(calcul|formula|equation|proof|algorithm|code|program|derivative|integral|matrix|vector|probability|statistics|physics|chemistry|circuit|network|database|sql|java|python|react|typescript|funktion|gleichung|ableitung|integral|matrix|vektor|wahrscheinlichkeit|statistik|physik|chemie|schaltung|netzwerk|datenbank)\b/i;

export const getModeLabel = (mode: StudyMode) => {
  switch (mode) {
    case 'beginner':
      return 'Beginner';
    case 'exam':
      return 'Exam';
    case 'normal':
    default:
      return 'Normal';
  }
};

export const buildStudyPrepContent = (
  mode: StudyMode,
  topic: string,
  keyConcepts: string[],
  t: (key: string, params?: Record<string, any>) => string,
  description?: string,
): StudyPrepContent => {
  const concepts = keyConcepts.length > 0 ? keyConcepts.slice(0, 6) : [topic];
  const conceptList = concepts.slice(0, 4).join(', ');
  const modePrimer: Record<StudyMode, string[]> = {
    beginner: [
      t('study.primerBeginnerMain', { topic }),
      t('study.primerBeginnerConcepts', { concepts: conceptList }),
      t('study.primerBeginnerRecognition'),
    ],
    normal: [
      t('study.primerNormalMain', { topic }),
      t('study.primerNormalConcepts', { concepts: conceptList }),
      t('study.primerNormalProgression'),
    ],
    exam: [
      t('study.primerExamMain', { topic }),
      t('study.primerExamConcepts', { concepts: conceptList }),
      t('study.primerExamProgression'),
    ],
  };
  const conceptMap = concepts.slice(0, 5).map((concept, index) => ({
    from: index === 0 ? topic : concepts[index - 1],
    relation:
      index === 0
        ? t('study.conceptMapSetsUp')
        : index === concepts.length - 1
          ? t('study.conceptMapLeadsTo')
          : t('study.conceptMapConnectsTo'),
    to: concept,
  }));
  const technicalText = `${topic} ${description ?? ''} ${concepts.join(' ')}`;
  const workedExample = TECHNICAL_TOPIC_PATTERN.test(technicalText)
    ? {
        title: t('study.workedExampleTitle', { concept: concepts[0] || topic }),
        steps: [
          t('study.workedExampleStepGiven', { concept: concepts[0] || topic }),
          t('study.workedExampleStepApply'),
          t('study.workedExampleStepCheck'),
        ],
      }
    : undefined;

  return {
    primer: modePrimer[mode],
    conceptMap,
    workedExample,
  };
};

export const buildSocraticHint = (
  question: StudyQuestion | null,
  t: (key: string, params?: Record<string, any>) => string,
) => {
  if (!question) return t('study.socraticHintDefault');

  const concept = question.targetConcepts?.[0];
  switch (question.checkType) {
    case 'why':
      return concept
        ? t('study.socraticHintWhyConcept', { concept })
        : t('study.socraticHintWhy');
    case 'apply':
      return t('study.socraticHintApply');
    case 'transfer':
      return t('study.socraticHintTransfer');
    case 'teach_back':
      return t('study.socraticHintTeachBack');
    case 'recall':
    default:
      return concept
        ? t('study.socraticHintRecallConcept', { concept })
        : t('study.socraticHintDefault');
  }
};

export const buildSessionSummaryText = ({
  t,
  topic,
  warmupAnswers,
  finalQuizAnswers,
  finalQuizAverage,
  mistakes,
}: {
  t: (key: string, params?: Record<string, any>) => string;
  topic: string;
  warmupAnswers: WarmupAnswer[];
  finalQuizAnswers: FinalQuizAnswer[];
  finalQuizAverage?: number;
  mistakes: StudyMistakeNotebookItem[];
}) => {
  const warmupCorrect = warmupAnswers.filter((answer) => answer.correct).length;
  const strongestFinal = [...finalQuizAnswers]
    .filter((answer) => typeof answer.score === 'number')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const weakestConcepts = Array.from(
    new Set(mistakes.map((item) => item.concept).filter(Boolean)),
  ).slice(0, 4);
  const strengths = [
    warmupAnswers.length
      ? t('study.endSummaryWarmupStrength', {
          correct: warmupCorrect,
          total: warmupAnswers.length,
        })
      : t('study.endSummaryNoWarmup'),
    strongestFinal
      ? t('study.endSummaryBestAnswer', {
          score: strongestFinal.score ?? 0,
          type: strongestFinal.checkType || 'recall',
        })
      : t('study.endSummaryRecallPractice'),
  ];
  const weakSpots = weakestConcepts.length
    ? weakestConcepts.map((concept) =>
        t('study.endSummaryWeakSpot', { concept }),
      )
    : [t('study.endSummaryNoWeakSpots')];
  const nextSteps = [
    t('study.endSummaryNextRecognition', { topic }),
    t('study.endSummaryNextRecall'),
    t('study.endSummaryNextApply'),
  ];

  return [
    t('study.endSummaryTitle', { topic }),
    '',
    t('study.endSummaryScore', {
      score: finalQuizAverage ?? 0,
    }),
    '',
    t('study.endSummaryStrengths'),
    ...strengths.map((item) => `• ${item}`),
    '',
    t('study.endSummaryWeakSpots'),
    ...weakSpots.map((item) => `• ${item}`),
    '',
    t('study.endSummaryNext'),
    ...nextSteps.map((item) => `• ${item}`),
  ].join('\n');
};

const normalizeRepeatText = (value: string) =>
  value.replace(/\s+/g, ' ').trim();

export const collapseRepeatedTutorText = (text: string) => {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length < 2 || paragraphs.length % 2 !== 0) {
    return text.trim();
  }

  const half = paragraphs.length / 2;
  const firstHalf = paragraphs.slice(0, half).join('\n\n');
  const secondHalf = paragraphs.slice(half).join('\n\n');

  if (
    normalizeRepeatText(firstHalf) &&
    normalizeRepeatText(firstHalf) === normalizeRepeatText(secondHalf)
  ) {
    return firstHalf;
  }

  return text.trim();
};
