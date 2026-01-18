import { GermanGrade, ReviewEvent, ReviewQuality, StudyPlanEntry } from '@/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * German university grading scale thresholds
 * Maps percentage ranges to grades (1.0 is best, 4.0 is minimum pass, Failed is below 45%)
 */
export const GRADE_THRESHOLDS: { min: number; grade: GermanGrade; label: string; color: string }[] = [
  { min: 85.5, grade: '1.0', label: 'Excellent', color: '#10b981' },
  { min: 81, grade: '1.3', label: 'Very Good', color: '#22c55e' },
  { min: 76.5, grade: '1.7', label: 'Very Good', color: '#34d399' },
  { min: 72, grade: '2.0', label: 'Good', color: '#84cc16' },
  { min: 67.5, grade: '2.3', label: 'Good', color: '#a3e635' },
  { min: 63, grade: '2.7', label: 'Satisfactory', color: '#eab308' },
  { min: 58.5, grade: '3.0', label: 'Satisfactory', color: '#f59e0b' },
  { min: 54, grade: '3.3', label: 'Sufficient', color: '#f97316' },
  { min: 49.5, grade: '3.7', label: 'Sufficient', color: '#fb923c' },
  { min: 45, grade: '4.0', label: 'Adequate', color: '#ef4444' },
  { min: 0, grade: 'Failed', label: 'Failed', color: '#dc2626' },
];

/**
 * Convert a percentage (0-100) to a German grade
 */
export const percentageToGrade = (percentage: number): GermanGrade => {
  const clamped = Math.max(0, Math.min(100, percentage));
  const threshold = GRADE_THRESHOLDS.find((t) => clamped >= t.min);
  return threshold?.grade ?? 'Failed';
};

/**
 * Get the color associated with a percentage/grade
 */
export const getGradeColor = (percentage: number): string => {
  const clamped = Math.max(0, Math.min(100, percentage));
  const threshold = GRADE_THRESHOLDS.find((t) => clamped >= t.min);
  return threshold?.color ?? '#dc2626';
};

/**
 * Get the label associated with a percentage/grade
 */
export const getGradeLabel = (percentage: number): string => {
  const clamped = Math.max(0, Math.min(100, percentage));
  const threshold = GRADE_THRESHOLDS.find((t) => clamped >= t.min);
  return threshold?.label ?? 'Failed';
};

type MasteryInputs = {
  history: ReviewEvent[];
  now?: Date;
};

/**
 * Compute a mastery score (0-100) using a hybrid of recent scores, recency decay,
 * and quality signals.
 */
export const computeMasteryScore = ({ history, now = new Date() }: MasteryInputs): number => {
  if (!history || history.length === 0) return 30; // low default until proven

  let weightedSum = 0;
  let weightTotal = 0;

  history.forEach((event) => {
    const reviewedAt = new Date(event.reviewedAt);
    const ageDays = Math.max(0, (now.getTime() - reviewedAt.getTime()) / MS_PER_DAY);

    // More recent events count more; half-life roughly 14 days
    const recencyWeight = Math.exp(-ageDays / 14);
    const score = clampScore(event.score ?? qualityToScore(event.responseQuality));

    weightedSum += score * recencyWeight;
    weightTotal += recencyWeight;
  });

  const base = weightTotal > 0 ? weightedSum / weightTotal : 30;

  // Apply gentle decay based on time since last review
  const lastReviewedAt = new Date(history[history.length - 1].reviewedAt);
  const ageSinceLast = Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / MS_PER_DAY);
  const decay = Math.exp(-ageSinceLast / 28); // slower decay for mastery

  return clampScore(base * decay);
};

/**
 * Compute the next review timestamp using a SM-2-inspired interval and ease factor.
 * - Higher mastery and ease_factor => longer interval
 * - Low mastery shrinks interval
 */
export const computeNextReviewDate = (args: {
  masteryScore: number;
  easeFactor?: number;
  reviewCount?: number;
  now?: Date;
}): string => {
  const { masteryScore, easeFactor = 2.5, reviewCount = 0, now = new Date() } = args;

  const normalizedMastery = clampScore(masteryScore) / 100; // 0..1
  const masteryMultiplier = 0.5 + normalizedMastery * 2.5; // 0.5..3.0

  let intervalDays: number;
  if (reviewCount <= 0) {
    intervalDays = 1; // first review in 1 day
  } else if (reviewCount === 1) {
    intervalDays = 2; // second review in 2 days
  } else {
    const base = Math.max(1, reviewCount);
    intervalDays = base * easeFactor * masteryMultiplier;
  }

  // Clamp interval to reasonable bounds
  intervalDays = Math.min(Math.max(intervalDays, 0.5), 60);

  const next = new Date(now.getTime() + intervalDays * MS_PER_DAY);
  return next.toISOString();
};

/**
 * Return entries that are due as of `now`.
 */
export const getItemsDueForReview = (entries: StudyPlanEntry[], now = new Date()): StudyPlanEntry[] => {
  return entries.filter((entry) => {
    if (!entry.nextReviewAt) return true; // never scheduled => due
    const next = new Date(entry.nextReviewAt);
    return next.getTime() <= now.getTime();
  });
};

/**
 * Select a daily quiz set that mixes weak, due, and high-priority items.
 */
export const selectDailyQuizItems = (
  entries: StudyPlanEntry[],
  count = 8,
  now = new Date()
): StudyPlanEntry[] => {
  const scored = entries.map((entry) => {
    const mastery = entry.masteryScore ?? 30;
    const due = !entry.nextReviewAt || new Date(entry.nextReviewAt).getTime() <= now.getTime();
    const priorityBoost = (entry.examRelevance === 'high' || entry.fromExamSource) ? 1.3 : 1;
    const weakBoost = mastery < 50 ? 1.4 : mastery < 70 ? 1.1 : 0.9;
    const dueBoost = due ? 1.6 : 1;
    const weight = priorityBoost * weakBoost * dueBoost;
    return { entry, weight };
  });

  // Weighted random selection without replacement
  const result: StudyPlanEntry[] = [];
  const pool = [...scored];
  while (pool.length > 0 && result.length < count) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    const r = Math.random() * totalWeight;
    let accum = 0;
    const idx = pool.findIndex((item) => {
      accum += item.weight;
      return r <= accum;
    });
    const chosen = idx >= 0 ? pool.splice(idx, 1)[0] : pool.pop();
    if (chosen) result.push(chosen.entry);
  }
  return result;
};

const clampScore = (score?: number | null): number => {
  if (score === undefined || score === null || Number.isNaN(score)) return 0;
  return Math.min(100, Math.max(0, score));
};

const qualityToScore = (quality?: ReviewQuality): number => {
  switch (quality) {
    case 'correct':
      return 90;
    case 'partial':
      return 65;
    case 'skipped':
      return 35;
    case 'incorrect':
    default:
      return 20;
  }
};

