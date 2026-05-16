import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExamSprintPlan,
  getExamSprintTaskActionLabel,
} from '../lib/exam-sprint-orchestrator';
import {
  LectureCheatSheet,
  PlanSettings,
  PracticeExam,
  StudyPlanEntry,
  StudyReadiness,
} from '../types';

const entry = (patch: Partial<StudyPlanEntry> & Pick<StudyPlanEntry, 'id' | 'title'>): StudyPlanEntry => ({
  lectureId: 'lecture-1',
  keyConcepts: [],
  orderIndex: 0,
  createdAt: '2026-05-01T00:00:00.000Z',
  ...patch,
});

const exam = (patch: Partial<PracticeExam> & Pick<PracticeExam, 'id'>): PracticeExam => ({
  lectureId: 'lecture-1',
  title: `Exam ${patch.id}`,
  status: 'completed',
  questionCount: 5,
  createdAt: '2026-05-01T00:00:00.000Z',
  ...patch,
});

const settings = (patch: Partial<PlanSettings> = {}): PlanSettings => ({
  examDate: '2026-05-20',
  targetGrade: 'pass',
  preferredSessionMinutes: 45,
  weeklyStudyMinutes: 630,
  currentLevel: 'some-background',
  ...patch,
});

const readiness = (percentage: number): StudyReadiness => ({
  percentage,
  predictedGrade: percentage >= 45 ? '4.0' : 'Failed',
  updatedAt: '2026-05-17T09:00:00.000Z',
});

test('exam sprint requires setup when no future exam date is available', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({ examDate: '' }),
    planEntries: [],
  });

  assert.equal(plan.status, 'setup_required');
  assert.equal(plan.riskLevel, 'critical');
  assert.equal(plan.days.length, 0);
  assert.equal(plan.nextTask?.action, 'set_exam_date');
});

test('exam sprint creates capacity-bound daily tasks and prioritizes pass-first topics', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({
      examDate: '2026-05-20',
      weakAreas: ['vectors'],
    }),
    readiness: readiness(52),
    flashcardCount: 8,
    planEntries: [
      entry({
        id: 'stretch',
        title: 'Optional proof extension',
        importanceTier: 'stretch',
        priorityScore: 100,
        status: 'not_started',
        estimatedMinutes: 60,
        orderIndex: 0,
      }),
      entry({
        id: 'core',
        title: 'Vector spaces',
        category: 'Linear Algebra',
        importanceTier: 'core',
        priorityScore: 70,
        status: 'failed',
        fromExamSource: true,
        estimatedMinutes: 45,
        orderIndex: 1,
      }),
      entry({
        id: 'passed',
        title: 'Matrix multiplication',
        category: 'Linear Algebra',
        importanceTier: 'core',
        status: 'passed',
        estimatedMinutes: 45,
        orderIndex: 2,
      }),
    ],
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.daysUntilExam, 3);
  assert.equal(plan.dailyCapacityMinutes, 90);
  assert.equal(plan.days.length, 3);
  assert.ok(plan.days.every((day) => day.totalMinutes <= day.capacityMinutes));
  assert.equal(plan.nextTask?.studyPlanEntryId, 'core');
  assert.equal(plan.nextTask?.type, 'study');
  assert.ok(
    plan.days.flatMap((day) => day.tasks).some((task) => task.type === 'review'),
    'passed topics or flashcards should reserve recall review',
  );
});

test('exam sprint uses preferred session minutes when weekly time is missing', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({
      examDate: '2026-05-18',
      preferredSessionMinutes: 50,
      weeklyStudyMinutes: undefined,
    }),
    readiness: readiness(80),
    planEntries: [
      entry({
        id: 'topic',
        title: 'Definitions',
        importanceTier: 'core',
        status: 'not_started',
      }),
    ],
  });

  assert.equal(plan.dailyCapacityMinutes, 100);
  assert.equal(plan.daysUntilExam, 1);
});

test('exam sprint falls back to default session timing and future day labels', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: {
      examDate: '2026-05-22',
      targetGrade: '1.0',
    },
    readiness: readiness(92),
    planEntries: [
      entry({
        id: 'topic',
        title: 'Core definition',
        importanceTier: 'core',
        status: 'not_started',
      }),
    ],
  });

  assert.equal(plan.dailyCapacityMinutes, 90);
  assert.equal(plan.riskLevel, 'on_track');
  assert.match(plan.days[2].label, /[A-Z][a-z]{2}/);
});

test('exam sprint opens an unfinished cluster quiz when one exists', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({ examDate: '2026-05-19' }),
    readiness: readiness(72),
    practiceExams: [
      exam({
        id: 'cluster-ready',
        category: 'Analysis',
        status: 'ready',
      }),
    ],
    planEntries: [
      entry({
        id: 'passed-analysis',
        title: 'Sequences',
        category: 'Analysis',
        importanceTier: 'core',
        status: 'passed',
      }),
    ],
  });

  const clusterTask = plan.days.flatMap((day) => day.tasks).find((task) => task.type === 'cluster_quiz');

  assert.equal(clusterTask?.action, 'open_cluster_quiz');
  assert.equal(clusterTask?.practiceExamId, 'cluster-ready');
  assert.equal(getExamSprintTaskActionLabel(clusterTask!), 'Open quiz');
  assert.equal(getExamSprintTaskActionLabel({ action: 'set_exam_date' }), 'Set exam date');
  assert.equal(getExamSprintTaskActionLabel({ action: 'start_topic' }), 'Start topic');
  assert.equal(getExamSprintTaskActionLabel({ action: 'review_flashcards' }), 'Review cards');
  assert.equal(getExamSprintTaskActionLabel({ action: 'generate_practice_exam' }), 'Generate exam');
});

test('exam sprint recommends practice and suppresses passed cluster quiz duplicates', () => {
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({ examDate: '2026-05-19' }),
    readiness: readiness(74),
    practiceExams: [
      exam({
        id: 'cluster-pass',
        category: 'Statistics',
        score: 80,
        status: 'completed',
      }),
      exam({
        id: 'full-ready',
        category: undefined,
        status: 'ready',
      }),
    ],
    planEntries: [
      entry({
        id: 'passed-1',
        title: 'Sampling distributions',
        category: 'Statistics',
        importanceTier: 'core',
        status: 'passed',
      }),
      entry({
        id: 'open-1',
        title: 'Confidence intervals',
        category: 'Statistics',
        importanceTier: 'high-yield',
        status: 'not_started',
      }),
    ],
  });

  const tasks = plan.days.flatMap((day) => day.tasks);

  assert.ok(tasks.some((task) => task.action === 'open_practice_exam' && task.practiceExamId === 'full-ready'));
  assert.ok(!tasks.some((task) => task.type === 'cluster_quiz'));
});

test('exam sprint adds cluster and cheat sheet actions when they are useful', () => {
  const cheatSheet: LectureCheatSheet = {
    lectureId: 'lecture-1',
    enabled: true,
    status: 'idle',
    evidenceCount: 3,
  };
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings: settings({ examDate: '2026-05-19' }),
    readiness: readiness(48),
    cheatSheet,
    practiceExams: [],
    planEntries: [
      entry({
        id: 'passed-1',
        title: 'Limits',
        category: 'Calculus',
        importanceTier: 'core',
        status: 'passed',
      }),
    ],
  });

  const tasks = plan.days.flatMap((day) => day.tasks);
  const clusterTask = tasks.find((task) => task.type === 'cluster_quiz');
  const cheatSheetTask = tasks.find((task) => task.type === 'cheat_sheet');

  assert.equal(clusterTask?.action, 'generate_cluster_quiz');
  assert.equal(clusterTask?.category, 'Calculus');
  assert.equal(cheatSheetTask?.action, 'open_cheat_sheet');
  assert.equal(getExamSprintTaskActionLabel(clusterTask!), 'Take quiz');
  assert.equal(getExamSprintTaskActionLabel(cheatSheetTask!), 'Open cheat sheet');
});
