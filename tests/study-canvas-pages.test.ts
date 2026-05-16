import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInitialCanvasPage,
  createStudyCanvasPage,
  getNextStagePageNumber,
  getStageInfoForPage,
  growPageNearEdge,
  replacePageStrokes,
  replacePageTitleStrokes,
} from '../lib/study/study-canvas-pages';
import { CanvasPage, CanvasStrokeData } from '../types';

test('canvas page helpers create reusable stage-aware pages', () => {
  const page = createStudyCanvasPage({
    id: 'page-1',
    stage: {
      stageKind: 'answer',
      stageId: 'message-1',
      stageLabel: 'Answer',
    },
    stagePageNumber: 2,
  });

  assert.equal(page.id, 'page-1');
  assert.equal(page.stageKind, 'answer');
  assert.equal(page.stageId, 'message-1');
  assert.equal(page.stageLabel, 'Answer');
  assert.equal(page.stagePageNumber, 2);
  assert.deepEqual(page.strokes, []);
  assert.deepEqual(page.titleStrokes, []);

  assert.deepEqual(getStageInfoForPage(page), {
    stageKind: 'answer',
    stageId: 'message-1',
    stageLabel: 'Answer',
  });
  assert.equal(getStageInfoForPage(buildInitialCanvasPage()), null);
});

test('canvas page helpers calculate the next page number per stage', () => {
  const pages: CanvasPage[] = [
    createStudyCanvasPage({
      id: 'page-1',
      stage: { stageKind: 'answer', stageId: 'message-1', stageLabel: 'Answer' },
      stagePageNumber: 1,
    }),
    createStudyCanvasPage({
      id: 'page-2',
      stage: { stageKind: 'answer', stageId: 'message-1', stageLabel: 'Answer' },
      stagePageNumber: 2,
    }),
    createStudyCanvasPage({
      id: 'page-3',
      stage: { stageKind: 'recall', stageId: 'message-1', stageLabel: 'Recall' },
      stagePageNumber: 1,
    }),
  ];

  assert.equal(
    getNextStagePageNumber(pages, {
      stageKind: 'answer',
      stageId: 'message-1',
      stageLabel: 'Answer',
    }),
    3,
  );
  assert.equal(
    getNextStagePageNumber(pages, {
      stageKind: 'final_quiz',
      stageId: 'message-2',
      stageLabel: 'Final quiz',
    }),
    1,
  );
});

test('canvas page helpers update strokes without touching other pages', () => {
  const stroke: CanvasStrokeData = {
    color: '#111827',
    width: 2,
    points: [{ x: 1, y: 2 }],
  };
  const pages = [buildInitialCanvasPage('page-1'), buildInitialCanvasPage('page-2')];

  const withStrokes = replacePageStrokes(pages, 'page-2', [stroke]);
  assert.equal(withStrokes[0].strokes.length, 0);
  assert.deepEqual(withStrokes[1].strokes, [stroke]);

  const withTitle = replacePageTitleStrokes(withStrokes, 'page-1', [stroke]);
  assert.deepEqual(withTitle[0].titleStrokes, [stroke]);
  assert.deepEqual(withTitle[1].titleStrokes, []);
});

test('canvas page helpers grow only when drawing near active page edges', () => {
  const pages = [buildInitialCanvasPage('page-1'), buildInitialCanvasPage('page-2')];
  const unchanged = growPageNearEdge(pages, 'page-1', { x: 100, y: 100 });
  assert.equal(unchanged[0].width, pages[0].width);
  assert.equal(unchanged[0].height, pages[0].height);

  const inactivePageUnchanged = growPageNearEdge(pages, 'page-1', {
    x: pages[1].width - 10,
    y: pages[1].height - 10,
  });
  assert.equal(inactivePageUnchanged[1], pages[1]);

  const grown = growPageNearEdge(pages, 'page-2', {
    x: pages[1].width - 10,
    y: pages[1].height - 10,
  });
  assert.equal(grown[0].width, pages[0].width);
  assert.equal(grown[1].width, pages[1].width + 600);
  assert.equal(grown[1].height, pages[1].height + 600);
});
