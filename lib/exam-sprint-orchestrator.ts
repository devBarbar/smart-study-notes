import type {
  ExamSprintDay,
  ExamSprintPlan,
  ExamSprintRiskLevel,
  ExamSprintTask,
  ExamSprintTaskAction,
  LectureCheatSheet,
  PlanSettings,
  PracticeExam,
  StudyPlanEntry,
  StudyReadiness,
} from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_MINUTES = 45;
const DEFAULT_CLUSTER_PASS_THRESHOLD = 70;

type BuildExamSprintPlanInput = {
  now?: Date | string;
  planSettings?: PlanSettings | null;
  planEntries: StudyPlanEntry[];
  readiness?: StudyReadiness;
  practiceExams?: PracticeExam[];
  flashcardCount?: number;
  cheatSheet?: LectureCheatSheet;
  clusterQuizPassThreshold?: number;
};

const targetReadinessThresholds: Record<string, number> = {
  pass: 45,
  '4.0': 45,
  '3.7': 50,
  '3.3': 54,
  '3.0': 59,
  '2.7': 63,
  '2.3': 68,
  '2.0': 72,
  '1.7': 77,
  '1.3': 81,
  '1.0': 86,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const parseDateOnly = (value?: string) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDateId = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const buildDayLabel = (index: number, date: Date) => {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

const getPreferredSessionMinutes = (settings?: PlanSettings | null) => {
  const configuredMinutes = Number(settings?.preferredSessionMinutes);
  const sessionMinutes =
    Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : DEFAULT_SESSION_MINUTES;
  return clamp(Math.round(sessionMinutes), 15, 180);
};

const getDailyCapacityMinutes = (settings?: PlanSettings | null) => {
  const preferred = getPreferredSessionMinutes(settings);
  const weekly = Number(settings?.weeklyStudyMinutes);
  const rawDaily = Number.isFinite(weekly) && weekly > 0 ? weekly / 7 : preferred * 2;
  return clamp(Math.round(rawDaily), preferred, 360);
};

const targetReadinessThreshold = (settings?: PlanSettings | null) =>
  targetReadinessThresholds[String(settings?.targetGrade ?? 'pass')] ?? 45;

const normalizeText = (value: string) => value.trim().toLowerCase();

const matchesWeakArea = (entry: StudyPlanEntry, weakAreas: string[] = []) => {
  const textParts = [entry.title, entry.category, entry.description, ...(entry.keyConcepts ?? [])]
    .filter(Boolean);
  const searchable = normalizeText(textParts.join(' '));
  return weakAreas.some((area) => {
    const normalized = normalizeText(area);
    return normalized.length > 0 && searchable.includes(normalized);
  });
};

const scoreStudyEntry = (entry: StudyPlanEntry, settings?: PlanSettings | null) => {
  const tierScore =
    entry.importanceTier === 'core' ? 42 : entry.importanceTier === 'high-yield' ? 38 : 5;
  const statusScore =
    entry.status === 'failed' ? 45 : entry.status === 'in_progress' ? 25 : 18;
  const examScore = entry.fromExamSource ? 32 : entry.examRelevance === 'high' ? 26 : 0;
  const notesScore = entry.mentionedInNotes ? 20 : 0;
  const weakScore = matchesWeakArea(entry, settings?.weakAreas) ? 28 : 0;
  const priorityScore = clamp(Number(entry.priorityScore) || 0, 0, 100) * 0.35;
  const masteryScore = typeof entry.masteryScore === 'number' ? (100 - entry.masteryScore) * 0.12 : 0;
  const orderScore = Math.max(0, 10 - entry.orderIndex * 0.2);

  return tierScore + statusScore + examScore + notesScore + weakScore + priorityScore + masteryScore + orderScore;
};

const taskMinutes = (minutes: number | undefined, max: number) =>
  clamp(Math.round(Number(minutes) || DEFAULT_SESSION_MINUTES), 20, Math.max(20, max));

const buildStudyTask = (entry: StudyPlanEntry, settings: PlanSettings | null | undefined, maxMinutes: number): ExamSprintTask => ({
  id: `study:${entry.id}`,
  type: 'study',
  action: 'start_topic',
  title: `Study ${entry.title}`,
  subtitle: [
    entry.importanceTier ?? 'topic',
    entry.status === 'failed' ? 'needs repair' : entry.status?.replace('_', ' ') ?? 'not started',
  ].join(' · '),
  estimatedMinutes: taskMinutes(entry.estimatedMinutes ?? settings?.preferredSessionMinutes, maxMinutes),
  priority: scoreStudyEntry(entry, settings),
  studyPlanEntryId: entry.id,
  category: entry.category,
});

const latestExam = (exams: PracticeExam[]) =>
  [...exams].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

const isOpenPracticeExam = (exam?: PracticeExam) =>
  exam?.status === 'ready' || exam?.status === 'in_progress';

const buildClusterTasks = (
  entries: StudyPlanEntry[],
  practiceExams: PracticeExam[],
  maxMinutes: number,
  threshold: number,
): ExamSprintTask[] => {
  const categories = new Map<string, StudyPlanEntry[]>();
  entries.forEach((entry) => {
    if (entry.status !== 'passed') return;
    const category = entry.category ?? 'General';
    categories.set(category, [...(categories.get(category) ?? []), entry]);
  });

  return Array.from(categories.entries()).flatMap(([category, categoryEntries]) => {
    const quizzes = practiceExams.filter((exam) => exam.category === category);
    const latestQuiz = latestExam(quizzes);
    const passedQuiz =
      latestQuiz?.status === 'completed' && typeof latestQuiz.score === 'number' && latestQuiz.score >= threshold;
    if (passedQuiz) return [];

    return [{
      id: `cluster:${category}`,
      type: 'cluster_quiz',
      action: isOpenPracticeExam(latestQuiz) ? 'open_cluster_quiz' : 'generate_cluster_quiz',
      title: `Cluster quiz: ${category}`,
      subtitle: `${categoryEntries.length} passed topic${categoryEntries.length === 1 ? '' : 's'} ready`,
      estimatedMinutes: clamp(maxMinutes, 25, 45),
      priority: 70 + categoryEntries.length,
      category,
      practiceExamId: isOpenPracticeExam(latestQuiz) ? latestQuiz?.id : undefined,
    } satisfies ExamSprintTask];
  });
};

const buildReviewTask = (dayIndex: number, minutes: number): ExamSprintTask => ({
  id: `review:${dayIndex}`,
  type: 'review',
  action: 'review_flashcards',
  title: 'Review flashcards & recall',
  subtitle: 'Keep passed topics fresh before the exam',
  estimatedMinutes: minutes,
  priority: 60,
});

const buildPracticeTask = (
  practiceExams: PracticeExam[],
  maxMinutes: number,
): ExamSprintTask => {
  const fullExam = latestExam(practiceExams.filter((exam) => !exam.category));
  const action: ExamSprintTaskAction = isOpenPracticeExam(fullExam)
    ? 'open_practice_exam'
    : 'generate_practice_exam';

  return {
    id: 'practice:full',
    type: 'practice_exam',
    action,
    title: action === 'open_practice_exam' ? 'Continue practice exam' : 'Generate practice exam',
    subtitle: 'Use passed topics to rehearse under exam pressure',
    estimatedMinutes: clamp(maxMinutes, 30, 75),
    priority: 68,
    practiceExamId: action === 'open_practice_exam' ? fullExam?.id : undefined,
  };
};

const buildCheatSheetTask = (minutes: number): ExamSprintTask => ({
  id: 'cheat-sheet:final',
  type: 'cheat_sheet',
  action: 'open_cheat_sheet',
  title: 'Refresh cheat sheet',
  subtitle: 'Review the biggest answer gaps before exam day',
  estimatedMinutes: minutes,
  priority: 55,
});

const buildSetupPlan = (now: Date, readiness?: StudyReadiness): ExamSprintPlan => {
  const plan: ExamSprintPlan = {
    status: 'setup_required', daysUntilExam: 0, dailyCapacityMinutes: 0, totalAvailableMinutes: 0,
    readiness, riskLevel: 'critical', days: [],
    nextTask: { id: 'setup:exam-date', type: 'setup', action: 'set_exam_date', title: 'Add exam date', subtitle: 'Set the deadline so the sprint can budget your study time', estimatedMinutes: 5, priority: 100 },
    generatedAt: now.toISOString(),
  };
  return plan;
};

const getRiskLevel = ({
  readiness,
  requiredMinutes,
  totalAvailableMinutes,
  settings,
}: {
  readiness?: StudyReadiness;
  requiredMinutes: number;
  totalAvailableMinutes: number;
  settings?: PlanSettings | null;
}): ExamSprintRiskLevel => {
  if ((readiness?.percentage ?? 0) < 45 || requiredMinutes > totalAvailableMinutes) {
    return 'critical';
  }

  if (
    (readiness?.percentage ?? 0) < targetReadinessThreshold(settings) ||
    totalAvailableMinutes - requiredMinutes < requiredMinutes * 0.25
  ) {
    return 'tight';
  }

  return 'on_track';
};

const addTaskIfFits = (day: ExamSprintDay, task: ExamSprintTask) => {
  if (day.totalMinutes + task.estimatedMinutes > day.capacityMinutes) return false;
  day.tasks.push(task);
  day.totalMinutes += task.estimatedMinutes;
  return true;
};

export const buildExamSprintPlan = ({
  now,
  planSettings,
  planEntries,
  readiness,
  practiceExams = [],
  flashcardCount = 0,
  cheatSheet,
  clusterQuizPassThreshold = DEFAULT_CLUSTER_PASS_THRESHOLD,
}: BuildExamSprintPlanInput): ExamSprintPlan => {
  const current = typeof now === 'string' ? new Date(now) : now ?? new Date();
  const today = startOfLocalDay(current);
  const examDate = parseDateOnly(planSettings?.examDate);
  if (!examDate || examDate.getTime() < today.getTime()) {
    return buildSetupPlan(current, readiness);
  }

  const daysUntilExam = Math.max(1, Math.round((examDate.getTime() - today.getTime()) / DAY_MS));
  const dailyCapacityMinutes = getDailyCapacityMinutes(planSettings);
  const totalAvailableMinutes = daysUntilExam * dailyCapacityMinutes;
  const reviewMinutes = flashcardCount > 0 || planEntries.some((entry) => entry.status === 'passed')
    ? clamp(Math.round(getPreferredSessionMinutes(planSettings) / 3), 10, 20)
    : 0;
  const shouldShowCheatSheet = Boolean(cheatSheet?.enabled || (cheatSheet?.evidenceCount ?? 0) > 0);
  const cheatSheetMinutes = shouldShowCheatSheet ? 10 : 0;
  const practiceMinutes = Math.max(30, dailyCapacityMinutes - reviewMinutes - cheatSheetMinutes);
  const days: ExamSprintDay[] = Array.from({ length: daysUntilExam }, (_, index) => {
    const date = addDays(today, index);
    return {
      date: toDateId(date),
      label: buildDayLabel(index, date),
      capacityMinutes: dailyCapacityMinutes,
      totalMinutes: 0,
      tasks: [],
    };
  });
  const unresolvedEntries = planEntries.filter((entry) => entry.status !== 'passed');
  const studyCapacity = Math.max(20, dailyCapacityMinutes - reviewMinutes);
  const focusTasks = [
    ...unresolvedEntries.map((entry) => buildStudyTask(entry, planSettings, studyCapacity)),
    ...buildClusterTasks(planEntries, practiceExams, studyCapacity, clusterQuizPassThreshold),
  ].sort((a, b) => b.priority - a.priority);
  const requiredMinutes = focusTasks
    .filter((task) => task.type === 'study')
    .reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const hasPassedTopics = planEntries.some((entry) => entry.status === 'passed');
  const finalDay = days[days.length - 1];

  if (hasPassedTopics && finalDay) {
    addTaskIfFits(finalDay, buildPracticeTask(practiceExams, practiceMinutes));
  }

  /* node:coverage ignore next 9 */
  for (const task of focusTasks) {
    for (const day of days) {
      if (addTaskIfFits(day, task)) break;
    }
  }

  if (reviewMinutes > 0) {
    for (const [index, day] of days.entries()) addTaskIfFits(day, buildReviewTask(index, reviewMinutes));
  }

  /* node:coverage ignore next 2 */
  if (shouldShowCheatSheet) {
    addTaskIfFits(finalDay, buildCheatSheetTask(10));
  }

  const nextTask = days.flatMap((day) => day.tasks)[0];

  const plan: ExamSprintPlan = { status: 'ready', daysUntilExam, dailyCapacityMinutes, totalAvailableMinutes, readiness, riskLevel: getRiskLevel({ readiness, requiredMinutes, totalAvailableMinutes, settings: planSettings }), days, nextTask, generatedAt: current.toISOString() };
  return plan;
};

export const getExamSprintTaskActionLabel = (task: Pick<ExamSprintTask, 'action'>) => {
  switch (task.action) {
    case 'set_exam_date':
      return 'Set exam date';
    case 'start_topic':
      return 'Start topic';
    case 'review_flashcards':
      return 'Review cards';
    case 'open_practice_exam':
      return 'Open exam';
    case 'generate_practice_exam':
      return 'Generate exam';
    case 'open_cluster_quiz':
      return 'Open quiz';
    case 'generate_cluster_quiz':
      return 'Take quiz';
    case 'open_cheat_sheet':
      return 'Open cheat sheet';
  }
};
