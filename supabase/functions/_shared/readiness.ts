type ProgressCounts = {
  passed?: number;
  inProgress?: number;
  notStarted?: number;
  failed?: number;
};

type ClusterQuizResult = {
  passed?: boolean;
  [key: string]: unknown;
};

type StageProgress = {
  completedDepthStages?: number;
  averageWeightedCompletion?: number;
  [key: string]: unknown;
};

export const calculateReadinessFallbackPercentage = ({
  entryCount,
  progress = {},
  stageProgress,
  clusterQuizResults = [],
}: {
  entryCount: number;
  progress?: ProgressCounts;
  stageProgress?: StageProgress | null;
  clusterQuizResults?: ClusterQuizResult[];
}) => {
  const total = Math.max(entryCount, 1);
  const passedClusters = clusterQuizResults.filter((quiz) => quiz.passed).length;
  const clusterBonus =
    clusterQuizResults.length > 0 ? (passedClusters / clusterQuizResults.length) * 0.15 : 0;
  const statusSignal =
    (Number(progress.passed) || 0) > 0 ||
    (Number(progress.inProgress) || 0) > 0 ||
    (Number(progress.failed) || 0) > 0;
  const stageSignal = (Number(stageProgress?.completedDepthStages) || 0) > 0;
  const hasAnySignal = statusSignal || stageSignal || clusterQuizResults.length > 0;

  if (!hasAnySignal) return 0;

  const legacyCompletionRatio =
    ((Number(progress.passed) || 0) +
      (Number(progress.inProgress) || 0) * 0.6 +
      (Number(progress.failed) || 0) * 0.3) /
    total;
  const completionRatio =
    typeof stageProgress?.averageWeightedCompletion === "number"
      ? stageProgress.averageWeightedCompletion
      : legacyCompletionRatio;

  return Math.max(0, Math.min(100, Math.round(20 + Math.min(1, completionRatio + clusterBonus) * 70)));
};
