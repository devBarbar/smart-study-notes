import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import { act, renderHook, waitFor } from '@testing-library/react-native/pure';

import { useStudyCanvasPages } from '../hooks/use-study-canvas-pages';
import { insertCanvasFeedbackBlockBelowAnswer } from '../lib/study/canvas-feedback';
import {
  resetSupabaseRequests,
  supabaseRequests,
  supabaseServer,
} from './utils/supabase-msw';

before(() => {
  supabaseServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  resetSupabaseRequests();
  supabaseServer.resetHandlers();
});

after(() => {
  supabaseServer.close();
});

test('ensureCanvasStagePage returns the activated canvas page and persists it over HTTP', async () => {
  const { result, unmount } = renderHook(() =>
    useStudyCanvasPages({ sessionId: 'session-1' }),
  );

  await act(async () => {
    result.current.setInitialBlankPage();
  });

  let page = result.current.canvasPages[0];
  await act(async () => {
    page = result.current.ensureCanvasStagePage('guided_notes', 'message-1');
  });

  assert.equal(page.stageKind, 'guided_notes');
  assert.equal(page.stageId, 'message-1');
  assert.equal(page.stagePageNumber, 1);
  assert.equal(result.current.activePageId, page.id);

  await waitFor(() => {
    assert.equal(supabaseRequests.length, 1);
  }, { timeout: 500 });

  assert.equal(supabaseRequests[0].method, 'PATCH');
  assert.match(supabaseRequests[0].url, /\/rest\/v1\/sessions\?/);
  assert.deepEqual(
    (supabaseRequests[0].body as { canvas_pages: unknown[] }).canvas_pages,
    result.current.canvasPages,
  );

  await act(async () => {
    page = result.current.ensureCanvasStagePage('guided_notes', 'message-1');
  });

  assert.equal(page.id, result.current.activePageId);
  assert.equal(
    result.current.canvasPages.filter(
      (canvasPage) =>
        canvasPage.stageKind === 'guided_notes' &&
        canvasPage.stageId === 'message-1',
    ).length,
    1,
  );

  unmount();
  await waitFor(() => {
    assert.equal(supabaseRequests.length, 2);
  });
});

test('immediate feedback saves cancel stale debounced stroke saves', async () => {
  const { result, unmount } = renderHook(() =>
    useStudyCanvasPages({ sessionId: 'session-feedback-race' }),
  );

  await act(async () => {
    result.current.setInitialBlankPage();
  });

  await act(async () => {
    result.current.updateActivePageStrokes([
      {
        points: [
          { x: 80, y: 120 },
          { x: 180, y: 168 },
        ],
        color: '#0f172a',
        width: 3,
      },
    ]);
  });

  const inserted = insertCanvasFeedbackBlockBelowAnswer({
    pages: result.current.canvasPages,
    pageId: result.current.activePageId,
    messageId: 'feedback-message-1',
    feedback: {
      summary: 'Keep the causal explanation visible.',
      correctness: 'partially correct',
      score: 68,
      whatWentWrong: ['Missing the key cause'],
    },
    isPassed: false,
    answerBounds: { x: 80, y: 120, width: 220, height: 80 },
    id: 'feedback-block-1',
    createdAt: '2026-05-16T00:00:00.000Z',
  });

  await act(async () => {
    result.current.saveCanvasPagesNow(inserted.pages);
    result.current.setCanvasPages(inserted.pages);
  });

  await waitFor(() => {
    assert.equal(supabaseRequests.length, 1);
  });

  assert.equal(
    (
      supabaseRequests[0].body as {
        canvas_pages: { visualBlocks?: unknown[]; visual_blocks?: unknown[] }[];
      }
    ).canvas_pages[0].visualBlocks?.length,
    1,
  );

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });

  assert.equal(supabaseRequests.length, 1);
  assert.equal(result.current.activeVisualBlocks.length, 1);

  unmount();
});
