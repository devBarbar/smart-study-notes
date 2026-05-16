import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LECTURE_PROGRESS_RESET_RPC,
  emptyLectureProgressCounts,
  getLectureProgressResetInvalidationKeys,
} from '../lib/lecture-progress-reset';
import { resetLectureProgress } from '../lib/lecture-progress-reset-service';

test('lecture progress reset uses a dedicated scoped RPC', () => {
  assert.equal(LECTURE_PROGRESS_RESET_RPC, 'reset_lecture_progress');
});

test('lecture progress reset invalidates every derived progress cache for the lecture', () => {
  assert.deepEqual(getLectureProgressResetInvalidationKeys('lecture-1'), [
    ['lectures'],
    ['sessions'],
    ['practice-exams', 'lecture-1'],
    ['flashcards', 'lecture-1'],
    ['flashcard-count', 'lecture-1'],
  ]);
});

test('empty progress counts represent a fresh lecture without deleting materials or plan entries', () => {
  assert.deepEqual(emptyLectureProgressCounts, {
    sessions: 0,
    flashcards: 0,
    practiceExams: 0,
    cheatSheets: 0,
  });
});

test('resetLectureProgress calls the scoped RPC and normalizes count output', async () => {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return {
        data: {
          sessions: '2',
          flashcards: 3,
          practiceExams: null,
          cheatSheets: 1,
        },
        error: null,
      };
    },
  };

  assert.deepEqual(
    await resetLectureProgress('lecture-1', {
      client,
      requireUser: async () => ({ id: 'user-1' }),
    }),
    {
      sessions: 2,
      flashcards: 3,
      practiceExams: 0,
      cheatSheets: 1,
    },
  );
  assert.deepEqual(calls, [
    {
      name: 'reset_lecture_progress',
      params: { p_lecture_id: 'lecture-1' },
    },
  ]);
});

test('resetLectureProgress surfaces RPC errors', async () => {
  const rpcError = new Error('reset failed');
  const client = {
    rpc: async () => ({ data: null, error: rpcError }),
  };

  await assert.rejects(
    resetLectureProgress('lecture-1', {
      client,
      requireUser: async () => ({ id: 'user-1' }),
    }),
    rpcError,
  );
});

test('resetLectureProgress requires a configured client', async () => {
  await assert.rejects(
    resetLectureProgress('lecture-1', {
      client: null,
      requireUser: async () => ({ id: 'user-1' }),
    }),
    /Supabase is not configured/,
  );
});

test('resetLectureProgress requires an authenticated user', async () => {
  await assert.rejects(
    resetLectureProgress('lecture-1', {
      client: { rpc: async () => ({ data: null, error: null }) },
      requireUser: async () => null,
    }),
    /User must be authenticated/,
  );
});
