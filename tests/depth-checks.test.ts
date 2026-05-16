import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPTH_PASS_SCORE,
  buildDepthQuestion,
  canPassStudyPlanEntry,
  feedbackPassesDepthCheck,
  findDepthProgressInText,
  getDepthProgressCount,
  getTargetPassScore,
  getNextTutorCheckType,
  normalizeTutorCheckType,
  buildDepthCheckProgressLine,
  stripDepthProgressFromText,
  REQUIRED_TUTOR_CHECK_TYPES,
} from '../lib/depth-checks';
import type { StudyDepthCheck, StudyPlanEntry } from '../types';

const baseCheck = (
  checkType: StudyDepthCheck['checkType'],
  score = DEPTH_PASS_SCORE,
): StudyDepthCheck => ({
  studyPlanEntryId: 'entry-1',
  questionText: `${checkType} question`,
  checkType,
  score,
  passed: true,
  canCountForPass: true,
});

test('normalizeTutorCheckType accepts aliases', () => {
  assert.equal(normalizeTutorCheckType('teach-back'), 'teach_back');
  assert.equal(normalizeTutorCheckType('mechanism'), 'why');
  assert.equal(normalizeTutorCheckType('unknown'), 'recall');
});

test('topic pass gate requires every required depth check', () => {
  const partial = REQUIRED_TUTOR_CHECK_TYPES
    .filter((type) => type !== 'transfer')
    .map((type) => baseCheck(type));

  assert.equal(canPassStudyPlanEntry(partial), false);
  assert.equal(getNextTutorCheckType(partial), 'transfer');

  const complete = REQUIRED_TUTOR_CHECK_TYPES.map((type) => baseCheck(type));
  assert.equal(canPassStudyPlanEntry(complete), true);
  assert.equal(getNextTutorCheckType(complete), null);
});

test('target grade maps to the rounded pass threshold', () => {
  assert.equal(getTargetPassScore('pass'), 70);
  assert.equal(getTargetPassScore('2.0'), 72);
  assert.equal(getTargetPassScore('1.7'), 77);
  assert.equal(getTargetPassScore('1.3'), 81);
  assert.equal(getTargetPassScore('1.0'), 86);
  assert.equal(getTargetPassScore('unexpected'), DEPTH_PASS_SCORE);
});

test('topic pass gate uses the selected target threshold', () => {
  const seventyPointChecks = REQUIRED_TUTOR_CHECK_TYPES.map((type) => baseCheck(type, 70));
  assert.equal(canPassStudyPlanEntry(seventyPointChecks, 'pass'), true);
  assert.equal(canPassStudyPlanEntry(seventyPointChecks, '2.0'), false);
  assert.equal(getNextTutorCheckType(seventyPointChecks, '2.0'), 'recall');
  assert.equal(getDepthProgressCount(seventyPointChecks, 'pass'), REQUIRED_TUTOR_CHECK_TYPES.length);

  const eightySixPointChecks = REQUIRED_TUTOR_CHECK_TYPES.map((type) => baseCheck(type, 86));
  assert.equal(canPassStudyPlanEntry(eightySixPointChecks, '1.0'), true);
  assert.equal(getNextTutorCheckType(eightySixPointChecks, '1.0'), null);
  assert.equal(
    buildDepthCheckProgressLine(eightySixPointChecks, '1.0'),
    'Recall done | Why done | Apply done | Transfer done | Teach-back done',
  );
});

test('saved depth checks are re-evaluated against the current target threshold', () => {
  const previouslyBelowTarget = REQUIRED_TUTOR_CHECK_TYPES.map((type) => ({
    ...baseCheck(type, 77),
    passed: false,
    canCountForPass: true,
  }));

  assert.equal(canPassStudyPlanEntry(previouslyBelowTarget, '1.7'), true);
  assert.equal(canPassStudyPlanEntry(previouslyBelowTarget, '1.3'), false);
  assert.equal(
    buildDepthCheckProgressLine(previouslyBelowTarget, '1.3'),
    'Recall open | Why open | Apply open | Transfer open | Teach-back open',
  );
});

test('feedback counts for pass at the selected target threshold and not when vetoed', () => {
  assert.equal(
    feedbackPassesDepthCheck(
      {
        summary: 'Good',
        correctness: 'correct',
        score: 72,
        canCountForPass: true,
      },
      '2.0',
    ),
    true,
  );

  assert.equal(
    feedbackPassesDepthCheck(
      {
        summary: 'Close but not enough',
        correctness: 'correct',
        score: 71,
        canCountForPass: true,
      },
      '2.0',
    ),
    false,
  );

  assert.equal(
    feedbackPassesDepthCheck(
      {
        summary: 'Memorized',
        correctness: 'correct',
        score: 86,
        canCountForPass: false,
      },
      '1.0',
    ),
    false,
  );

  assert.equal(
    feedbackPassesDepthCheck(
      {
        summary: 'Missing score',
        correctness: 'correct',
        canCountForPass: true,
      },
      'pass',
    ),
    false,
  );
});

test('buildDepthQuestion targets the requested check type', () => {
  const entry: Pick<StudyPlanEntry, 'title' | 'description' | 'keyConcepts' | 'learningObjective'> = {
    title: 'Limits',
    description: 'Understand limit intuition.',
    keyConcepts: ['epsilon', 'delta'],
    learningObjective: 'Explain limits in plain language.',
  };

  assert.match(buildDepthQuestion('transfer', entry), /new or edge-case/i);
  assert.match(buildDepthQuestion('teach_back', entry), /Teach "Limits"/);
});

test('findDepthProgressInText parses tutor progress lines', () => {
  const parsed = findDepthProgressInText(
    [
      'Score: 0/100',
      'Depth progress: Recall done | Why open | Apply open | Transfer open | Teach-back open',
      'Source check:',
    ].join('\n'),
  );

  assert.equal(parsed?.recall, 'done');
  assert.equal(parsed?.why, 'open');
  assert.equal(parsed?.teach_back, 'open');
});

test('stripDepthProgressFromText removes progress metadata from chat copy', () => {
  const stripped = stripDepthProgressFromText(
    [
      'Score: 0/100',
      '',
      'Depth progress: Recall done | Why open | Apply open | Transfer open | Teach-back open',
      '',
      'Source check:',
    ].join('\n'),
  );

  assert.equal(stripped, 'Score: 0/100\n\nSource check:');
});
