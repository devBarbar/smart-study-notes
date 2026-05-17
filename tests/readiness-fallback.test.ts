import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateReadinessFallbackPercentage } from '../supabase/functions/_shared/readiness';

test('readiness fallback uses stage progress when it is present', () => {
  assert.equal(
    calculateReadinessFallbackPercentage({
      entryCount: 2,
      progress: { passed: 0, inProgress: 0, notStarted: 2, failed: 0 },
      stageProgress: {
        totalTopics: 2,
        completedDepthStages: 4,
        averageWeightedCompletion: 0.65,
        topics: [],
      },
      clusterQuizResults: [],
    }),
    66,
  );
});

test('readiness fallback preserves cluster quiz bonus with stage progress', () => {
  assert.equal(
    calculateReadinessFallbackPercentage({
      entryCount: 1,
      progress: { passed: 0, inProgress: 0, notStarted: 1, failed: 0 },
      stageProgress: {
        totalTopics: 1,
        completedDepthStages: 2,
        averageWeightedCompletion: 0.65,
        topics: [],
      },
      clusterQuizResults: [{ category: 'Basics', score: 75, passed: true, questionCount: 4 }],
    }),
    76,
  );
});

test('readiness fallback remains backward compatible without stage progress', () => {
  assert.equal(
    calculateReadinessFallbackPercentage({
      entryCount: 4,
      progress: { passed: 1, inProgress: 1, notStarted: 1, failed: 1 },
      clusterQuizResults: [],
    }),
    53,
  );
});
