import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import { http, HttpResponse } from 'msw';

import { listLectureDepthChecks } from '../lib/supabase';
import { supabaseServer } from './utils/supabase-msw';

before(() => {
  supabaseServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  supabaseServer.resetHandlers();
});

after(() => {
  supabaseServer.close();
});

test('listLectureDepthChecks loads and maps lecture-scoped depth checks', async () => {
  let requestUrl = '';
  supabaseServer.use(
    http.get('https://unit-test.supabase.co/rest/v1/study_depth_checks', ({ request }) => {
      requestUrl = request.url;
      return HttpResponse.json([
        {
          id: 'check-1',
          lecture_id: 'lecture-1',
          study_plan_entry_id: 'entry-1',
          session_id: 'session-1',
          question_id: 'question-1',
          question_text: 'Why does paging help?',
          check_type: 'why',
          score: 90,
          correctness: 'correct',
          passed: true,
          can_count_for_pass: true,
          feedback_summary: 'Solid mechanism explanation.',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]);
    }),
  );

  const checks = await listLectureDepthChecks('lecture-1', 25);

  assert.match(requestUrl, /lecture_id=eq\.lecture-1/);
  assert.match(requestUrl, /limit=25/);
  assert.deepEqual(checks, [
    {
      id: 'check-1',
      lectureId: 'lecture-1',
      studyPlanEntryId: 'entry-1',
      sessionId: 'session-1',
      questionId: 'question-1',
      questionText: 'Why does paging help?',
      checkType: 'why',
      score: 90,
      correctness: 'correct',
      passed: true,
      canCountForPass: true,
      feedbackSummary: 'Solid mechanism explanation.',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
});

test('listLectureDepthChecks returns an empty list when the table is missing', async () => {
  supabaseServer.use(
    http.get('https://unit-test.supabase.co/rest/v1/study_depth_checks', () =>
      HttpResponse.json(
        { code: '42P01', message: 'relation "study_depth_checks" does not exist' },
        { status: 404 },
      ),
    ),
  );

  assert.deepEqual(await listLectureDepthChecks('lecture-1'), []);
});

test('listLectureDepthChecks surfaces non-schema query errors', async () => {
  supabaseServer.use(
    http.get('https://unit-test.supabase.co/rest/v1/study_depth_checks', () =>
      HttpResponse.json(
        { code: 'PGRST100', message: 'bad query' },
        { status: 400 },
      ),
    ),
  );

  await assert.rejects(
    () => listLectureDepthChecks('lecture-1'),
    (error: any) => error?.code === 'PGRST100' && error?.message === 'bad query',
  );
});
