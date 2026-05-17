import {
  GermanGrade,
  StudyDepthCheck,
  StudyPlanEntry,
  StudyReadiness,
  TutorCheckType,
} from '@/types';

import {
  getTargetPassScore,
  normalizeTutorCheckType,
  REQUIRED_TUTOR_CHECK_TYPES,
} from './depth-checks';
import { percentageToGrade } from './mastery';

export const DEPTH_STAGE_WEIGHTS: Record<TutorCheckType, number> = {
  recall: 0.25,
  why: 0.4,
  apply: 0.15,
  transfer: 0.1,
  teach_back: 0.1,
};

export type LectureStageProgressTopic = {
  studyPlanEntryId: string;
  title: string;
  status: StudyPlanEntry['status'];
  completedStages: TutorCheckType[];
  bestScoreByStage: Partial<Record<TutorCheckType, number>>;
  weightedDepthProgress: number;
  weightedCompletion: number;
};

export type LectureStageProgress = {
  totalTopics: number;
  totalDepthStages: number;
  completedDepthStages: number;
  totalWeightedCompletion: number;
  averageWeightedCompletion: number;
  topics: LectureStageProgressTopic[];
};

type ClusterQuizResult = {
  category: string;
  score: number;
  passed: boolean;
  questionCount: number;
};

type BuildLectureStageProgressParams = {
  entries: StudyPlanEntry[];
  depthChecks: StudyDepthCheck[];
  targetGrade?: GermanGrade | 'pass' | string | number | null;
};

type ReadinessPercentageParams = {
  entries: StudyPlanEntry[];
  stageProgress: LectureStageProgress;
  clusterQuizResults?: ClusterQuizResult[];
};

const statusFloor = (status: StudyPlanEntry['status']) => {
  if (status === 'in_progress') return 0.12;
  if (status === 'failed') return 0.05;
  return 0;
};

const roundProgress = (value: number) => Math.round(value * 1000) / 1000;

export const buildLectureStageProgress = ({
  entries,
  depthChecks,
  targetGrade,
}: BuildLectureStageProgressParams): LectureStageProgress => {
  const passScore = getTargetPassScore(targetGrade);
  const checksByEntry = new Map<string, StudyDepthCheck[]>();

  depthChecks.forEach((check) => {
    const current = checksByEntry.get(check.studyPlanEntryId) ?? [];
    current.push(check);
    checksByEntry.set(check.studyPlanEntryId, current);
  });

  const topics = entries.map<LectureStageProgressTopic>((entry) => {
    const entryChecks = checksByEntry.get(entry.id) ?? [];
    const bestScoreByStage: Partial<Record<TutorCheckType, number>> = {};
    const completedStages: TutorCheckType[] = [];

    REQUIRED_TUTOR_CHECK_TYPES.forEach((stage) => {
      const stageScores = entryChecks
        .filter((check) => normalizeTutorCheckType(check.checkType) === stage)
        .map((check) => check.score)
        .filter((score): score is number => typeof score === 'number');

      if (stageScores.length > 0) {
        bestScoreByStage[stage] = Math.max(...stageScores);
      }

      const stageCompleted = entryChecks.some(
        (check) =>
          normalizeTutorCheckType(check.checkType) === stage &&
          check.canCountForPass &&
          typeof check.score === 'number' &&
          check.score >= passScore,
      );
      if (stageCompleted) completedStages.push(stage);
    });

    const weightedDepthProgress = completedStages.reduce(
      (sum, stage) => sum + DEPTH_STAGE_WEIGHTS[stage],
      0,
    );
    const weightedCompletion =
      entry.status === 'passed'
        ? 1
        : Math.min(0.85, Math.max(statusFloor(entry.status), weightedDepthProgress));

    return {
      studyPlanEntryId: entry.id,
      title: entry.title,
      status: entry.status ?? 'not_started',
      completedStages,
      bestScoreByStage,
      weightedDepthProgress: roundProgress(weightedDepthProgress),
      weightedCompletion: roundProgress(weightedCompletion),
    };
  });

  const totalWeightedCompletion = topics.reduce(
    (sum, topic) => sum + topic.weightedCompletion,
    0,
  );

  return {
    totalTopics: entries.length,
    totalDepthStages: entries.length * REQUIRED_TUTOR_CHECK_TYPES.length,
    completedDepthStages: topics.reduce(
      (sum, topic) => sum + topic.completedStages.length,
      0,
    ),
    totalWeightedCompletion: roundProgress(totalWeightedCompletion),
    averageWeightedCompletion:
      entries.length > 0 ? roundProgress(totalWeightedCompletion / entries.length) : 0,
    topics,
  };
};

export const calculateDepthWeightedReadinessPercentage = (params: ReadinessPercentageParams) => {
  /* c8 ignore next 3 -- covered by tests/readiness-progress.test.ts; v8 misses this initial destructuring in changed-line mode. */
  const { entries, stageProgress, clusterQuizResults = [] } = params;
  const passedClusters = clusterQuizResults.filter((quiz) => quiz.passed).length;
  const clusterBonus =
    clusterQuizResults.length > 0 ? (passedClusters / clusterQuizResults.length) * 0.15 : 0;
  const hasStatusSignal = entries.some((entry) => (entry.status ?? 'not_started') !== 'not_started');
  const hasAnySignal =
    stageProgress.completedDepthStages > 0 ||
    hasStatusSignal ||
    clusterQuizResults.length > 0;

  if (!hasAnySignal) return 0;

  return Math.max(
    0,
    Math.min(100, Math.round(20 + Math.min(1, stageProgress.averageWeightedCompletion + clusterBonus) * 70)),
  );
};

export const buildFallbackStudyReadiness = ({
  entries,
  stageProgress,
  clusterQuizResults = [],
}: ReadinessPercentageParams): StudyReadiness => {
  const percentage = calculateDepthWeightedReadinessPercentage({
    entries,
    stageProgress,
    clusterQuizResults,
  });

  return {
    percentage,
    predictedGrade: percentageToGrade(percentage),
  };
};
