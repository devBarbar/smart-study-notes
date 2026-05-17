import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLectureStageProgress,
  calculateDepthWeightedReadinessPercentage,
} from '../lib/readiness-progress';
import { REQUIRED_TUTOR_CHECK_TYPES } from '../lib/depth-checks';
import type { StudyDepthCheck, StudyPlanEntry } from '../types';

const entry = (
  id: string,
  status: StudyPlanEntry['status'] = 'not_started',
): StudyPlanEntry => ({
  id,
  lectureId: 'lecture-1',
  title: `Topic ${id}`,
  keyConcepts: [],
  orderIndex: Number(id.replace(/\D/g, '')) || 0,
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const check = (
  studyPlanEntryId: string,
  checkType: StudyDepthCheck['checkType'],
  score = 90,
  canCountForPass = true,
): StudyDepthCheck => ({
  studyPlanEntryId,
  questionText: `${checkType} question`,
  checkType,
  score,
  passed: score >= 90,
  canCountForPass,
});

test('depth-weighted readiness stays at zero without progress signals', () => {
  const entries = [entry('entry-1'), entry('entry-2')];
  const stageProgress = buildLectureStageProgress({
    entries,
    depthChecks: [],
    targetGrade: 'pass',
  });

  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress }), 0);
  assert.equal(stageProgress.completedDepthStages, 0);
});

test('recall-only progress across all topics gives an early but conservative boost', () => {
  const entries = [entry('entry-1'), entry('entry-2')];
  const stageProgress = buildLectureStageProgress({
    entries,
    depthChecks: entries.map((item) => check(item.id, 'recall', 90)),
    targetGrade: 'pass',
  });

  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress }), 38);
  assert.equal(stageProgress.averageWeightedCompletion, 0.25);
});

test('recall and why across all topics lands clearly above fifty percent', () => {
  const entries = [entry('entry-1'), entry('entry-2')];
  const depthChecks = entries.flatMap((item) => [
    check(item.id, 'recall', 90),
    check(item.id, 'why', 90),
  ]);
  const stageProgress = buildLectureStageProgress({
    entries,
    depthChecks,
    targetGrade: 'pass',
  });

  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress }), 66);
  assert.equal(stageProgress.averageWeightedCompletion, 0.65);
});

test('all depth stages without a final topic pass caps below passed-topic readiness', () => {
  const entries = [entry('entry-1'), entry('entry-2')];
  const depthChecks = entries.flatMap((item) =>
    REQUIRED_TUTOR_CHECK_TYPES.map((type) => check(item.id, type, 90)),
  );
  const stageProgress = buildLectureStageProgress({
    entries,
    depthChecks,
    targetGrade: 'pass',
  });

  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress }), 80);
  assert.equal(stageProgress.topics.every((topic) => topic.weightedCompletion === 0.85), true);
});

test('passed topics receive full completion and cluster quizzes can add a bonus', () => {
  const entries = [entry('entry-1', 'passed'), entry('entry-2', 'passed')];
  const stageProgress = buildLectureStageProgress({
    entries,
    depthChecks: [],
    targetGrade: 'pass',
  });

  assert.equal(
    calculateDepthWeightedReadinessPercentage({
      entries,
      stageProgress,
      clusterQuizResults: [{ category: 'Basics', score: 80, passed: true, questionCount: 4 }],
    }),
    90,
  );
});

test('target grade controls which depth checks count', () => {
  const entries = [entry('entry-1')];
  const depthChecks = [
    check('entry-1', 'recall', 77),
    check('entry-1', 'why', 77),
  ];

  const gradeOnePointSeven = buildLectureStageProgress({
    entries,
    depthChecks,
    targetGrade: '1.7',
  });
  const gradeOnePointThree = buildLectureStageProgress({
    entries,
    depthChecks,
    targetGrade: '1.3',
  });

  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress: gradeOnePointSeven }), 66);
  assert.equal(calculateDepthWeightedReadinessPercentage({ entries, stageProgress: gradeOnePointThree }), 0);
});
