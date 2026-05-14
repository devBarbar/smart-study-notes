import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPTH_PASS_SCORE,
  buildDepthQuestion,
  canPassStudyPlanEntry,
  feedbackPassesDepthCheck,
  findDepthProgressInText,
  getNextTutorCheckType,
  normalizeTutorCheckType,
  stripDepthProgressFromText,
  REQUIRED_TUTOR_CHECK_TYPES,
} from '../lib/depth-checks';
import type { StudyDepthCheck, StudyPlanEntry } from '../types';

const baseCheck = (checkType: StudyDepthCheck['checkType']): StudyDepthCheck => ({
  studyPlanEntryId: 'entry-1',
  questionText: `${checkType} question`,
  checkType,
  score: DEPTH_PASS_SCORE,
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
    .map(baseCheck);

  assert.equal(canPassStudyPlanEntry(partial), false);
  assert.equal(getNextTutorCheckType(partial), 'transfer');

  const complete = REQUIRED_TUTOR_CHECK_TYPES.map(baseCheck);
  assert.equal(canPassStudyPlanEntry(complete), true);
  assert.equal(getNextTutorCheckType(complete), null);
});

test('feedback only counts for pass at 90 or higher and not vetoed', () => {
  assert.equal(
    feedbackPassesDepthCheck({
      summary: 'Good',
      correctness: 'correct',
      score: DEPTH_PASS_SCORE,
      canCountForPass: true,
    }),
    true,
  );

  assert.equal(
    feedbackPassesDepthCheck({
      summary: 'Close but not enough',
      correctness: 'correct',
      score: DEPTH_PASS_SCORE - 1,
      canCountForPass: true,
    }),
    false,
  );

  assert.equal(
    feedbackPassesDepthCheck({
      summary: 'Memorized',
      correctness: 'correct',
      score: DEPTH_PASS_SCORE,
      canCountForPass: false,
    }),
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
