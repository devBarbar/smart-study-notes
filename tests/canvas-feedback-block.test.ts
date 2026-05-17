import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCanvasFeedbackData,
  estimateCanvasFeedbackBlockSize,
  getCanvasFeedbackToneColor,
  insertCanvasFeedbackBlockBelowAnswer,
} from '../lib/study/canvas-feedback';
import { buildInitialCanvasPage } from '../lib/study/study-canvas-pages';
import { CanvasBounds, CanvasFeedbackBlockData, StudyFeedback } from '../types';

const answerBounds: CanvasBounds = { x: 120, y: 220, width: 360, height: 140 };

test('canvas feedback data marks failed answers red with corrective details', () => {
  const feedback: StudyFeedback = {
    summary: 'The definition missed the causal part.',
    correctness: 'partially correct',
    score: 72,
    whatWentWrong: ['Missing the reason'],
    correctAnswer: 'A complete answer names the cause.',
    rewriteExample: 'The cause is X because Y.',
  };

  assert.deepEqual(buildCanvasFeedbackData(feedback, false), {
    status: 'failed',
    score: 72,
    summary: 'The definition missed the causal part.',
    whatWentRight: [],
    whatWentWrong: ['Missing the reason'],
    correctAnswer: 'A complete answer names the cause.',
    rewriteExample: 'The cause is X because Y.',
  });
});

test('canvas feedback tone colors and empty summaries are normalized', () => {
  assert.equal(getCanvasFeedbackToneColor('passed'), '#16a34a');
  assert.equal(getCanvasFeedbackToneColor('failed'), '#dc2626');
  assert.deepEqual(
    buildCanvasFeedbackData(
      {
        summary: '   ',
        correctness: 'unknown',
        whatWentRight: ['  useful term  ', ''],
        whatWentWrong: ['  missing reason  '],
      },
      false,
    ),
    {
      status: 'failed',
      score: undefined,
      summary: 'No summary',
      whatWentRight: ['useful term'],
      whatWentWrong: ['missing reason'],
      correctAnswer: undefined,
      rewriteExample: undefined,
    },
  );
});

test('canvas feedback data tolerates malformed AI fields', () => {
  const feedback = {
    summary: { text: 'not a string' },
    correctness: 'partially correct',
    score: Number.NaN,
    whatWentRight: ['  useful term  ', 42, null, { text: 'ignored' }],
    whatWentWrong: 'missing reason',
    correctAnswer: 123,
    rewriteExample: { text: 'not renderable' },
  } as unknown as StudyFeedback;

  assert.deepEqual(buildCanvasFeedbackData(feedback, false), {
    status: 'failed',
    score: undefined,
    summary: 'No summary',
    whatWentRight: ['useful term', '42'],
    whatWentWrong: [],
    correctAnswer: '123',
    rewriteExample: undefined,
  });
});

test('canvas feedback data marks passed answers green with strengths', () => {
  const feedback: StudyFeedback = {
    summary: 'Clear and complete.',
    correctness: 'correct',
    score: 95,
    whatWentRight: ['Named the key idea', 'Explained the relationship'],
    whatWentWrong: [],
  };

  const data = buildCanvasFeedbackData(feedback, true);
  assert.equal(data.status, 'passed');
  assert.equal(data.score, 95);
  assert.deepEqual(data.whatWentRight, [
    'Named the key idea',
    'Explained the relationship',
  ]);
  assert.deepEqual(data.whatWentWrong, []);
});

test('canvas feedback block size grows for detail sections and supports empty arrays', () => {
  const compact = estimateCanvasFeedbackBlockSize({
    status: 'passed',
    summary: 'Good.',
    whatWentRight: [],
    whatWentWrong: [],
  });
  const detailed = estimateCanvasFeedbackBlockSize({
    status: 'failed',
    score: 45,
    summary: 'Several gaps.',
    whatWentRight: ['Recognized the term'],
    whatWentWrong: ['Missed the method', 'Used the wrong formula'],
    correctAnswer: 'Use the source-consistent method.',
    rewriteExample: 'A stronger answer applies the method step by step.',
  });

  assert.equal(compact.width, 520);
  assert.ok(detailed.height > compact.height);
});

test('canvas feedback block is inserted below the answer and grows only the active page', () => {
  const pages = [buildInitialCanvasPage('page-1'), buildInitialCanvasPage('page-2')];
  const lowAnswerBounds: CanvasBounds = {
    ...answerBounds,
    y: pages[0].height - 90,
  };
  const feedback: StudyFeedback = {
    summary: 'You missed the final step.',
    correctness: 'incorrect',
    score: 40,
    whatWentWrong: ['Final step missing'],
  };

  const result = insertCanvasFeedbackBlockBelowAnswer({
    pages,
    pageId: 'page-1',
    messageId: 'feedback-1',
    feedback,
    isPassed: false,
    answerBounds: lowAnswerBounds,
    id: 'feedback-block-1',
    createdAt: '2026-05-16T00:00:00.000Z',
  });

  assert.equal(result.block.id, 'feedback-block-1');
  assert.equal(result.block.type, 'feedback');
  assert.equal(result.block.position.x, lowAnswerBounds.x);
  assert.equal(result.block.position.y, lowAnswerBounds.y + lowAnswerBounds.height + 32);
  assert.equal(result.pages[0].visualBlocks?.[0], result.block);
  assert.ok(result.pages[0].height > pages[0].height);
  assert.equal(result.pages[1], pages[1]);
});

test('canvas feedback insertion creates a visible page when no canvas page exists', () => {
  const feedback: StudyFeedback = {
    summary: 'The typed answer needs a concrete example.',
    correctness: 'partially correct',
    score: 64,
    whatWentWrong: ['Missing example'],
  };

  const result = insertCanvasFeedbackBlockBelowAnswer({
    pages: [],
    pageId: 'page-typed-answer',
    messageId: 'feedback-empty-canvas',
    feedback,
    isPassed: false,
    id: 'feedback-block-empty-canvas',
    createdAt: '2026-05-16T00:00:00.000Z',
  });

  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].id, 'page-typed-answer');
  assert.equal(result.pages[0].visualBlocks?.[0], result.block);
  const blockData = result.block.data as CanvasFeedbackBlockData;
  assert.equal(blockData.summary, 'The typed answer needs a concrete example.');
});
