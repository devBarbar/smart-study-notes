import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import { act, renderHook, waitFor } from '@testing-library/react-native/pure';

import { useStudyCanvasPages } from '../hooks/use-study-canvas-pages';
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
  });

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
});
