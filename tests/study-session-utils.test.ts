import assert from 'node:assert/strict';
import test from 'node:test';

import {
  balanceCitationChunks,
  cleanSourceFileName,
  getCitationSourceType,
} from '../lib/study/study-citations';
import {
  buildStudyPrepContent,
  buildSocraticHint,
  buildSessionSummaryText,
  collapseRepeatedTutorText,
  getModeLabel,
  shuffleStudyWarmupOptions,
} from '../lib/study/study-flow';
import {
  dedupeVisualBlocks,
  getVisualBlockInsertKey,
  getVisualBlockSignature,
  getVisualBlockBottom,
  normalizeCanvasPageVisualBlocks,
  stableStringify,
  estimateTokenCount,
  sessionHasInProgressCanvasWork,
} from '../lib/study/study-session-utils';
import { LectureFileChunk } from '../lib/supabase';
import { CanvasPage, CanvasVisualBlock } from '../types';

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

test('study session canvas helpers detect resumable work', () => {
  assert.equal(sessionHasInProgressCanvasWork(null), false);
  assert.equal(
    sessionHasInProgressCanvasWork({
      id: 'session-2',
      title: 'Session',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      notesText: 'draft',
    }),
    true,
  );
  assert.equal(
    sessionHasInProgressCanvasWork({
      id: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      canvasPages: [
        {
          id: 'page-1',
          titleStrokes: [],
          strokes: [],
          visualBlocks: [{ id: 'visual-1' } as CanvasVisualBlock],
          width: 100,
          height: 100,
        },
      ],
    }),
    true,
  );
});

test('visual block helpers produce stable signatures and remove duplicates per page', () => {
  const first: CanvasVisualBlock = {
    id: 'block-1',
    type: 'diagram',
    data: { b: 2, a: 1 },
    position: { x: 0, y: 0 },
    messageId: 'message-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as CanvasVisualBlock;
  const duplicate = { ...first, id: 'block-2' };
  const different = { ...first, id: 'block-3', data: { a: 1, b: 3 } } as unknown as CanvasVisualBlock;

  assert.equal(
    getVisualBlockSignature(first),
    getVisualBlockSignature({ ...first, data: { a: 1, b: 2 } } as unknown as CanvasVisualBlock),
  );
  assert.equal(stableStringify(['b', { a: 1 }]), '["b",{"a":1}]');
  assert.equal(stableStringify([]), '[]');
  assert.equal(estimateTokenCount(''), 0);
  assert.equal(estimateTokenCount('12345'), 2);
  assert.equal(getVisualBlockInsertKey('page-1', 'message-1', first), 'page-1:message-1:diagram:{"a":1,"b":2}');
  assert.equal(getVisualBlockBottom({ ...first, size: { width: 10, height: 20 } }), 20);
  assert.ok(
    getVisualBlockBottom({
      ...first,
      data: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
    } as unknown as CanvasVisualBlock) > 0,
  );
  assert.equal(dedupeVisualBlocks().length, 0);
  assert.deepEqual(dedupeVisualBlocks([first, duplicate, different]).map((block) => block.id), [
    'block-1',
    'block-3',
  ]);

  const page: CanvasPage = {
    id: 'page-1',
    titleStrokes: [],
    strokes: [],
    width: 100,
    height: 100,
    visualBlocks: [first, duplicate],
  };
  const normalized = normalizeCanvasPageVisualBlocks([page]);
  assert.equal(normalized.changed, true);
  assert.equal(normalized.pages[0].visualBlocks?.length, 1);
  assert.equal(
    normalizeCanvasPageVisualBlocks([{ ...page, id: 'page-2', visualBlocks: [] }]).changed,
    false,
  );
  assert.equal(normalizeCanvasPageVisualBlocks([{ ...page, visualBlocks: [first] }]).changed, false);
});

test('citation helpers clean names, classify files, and balance lecture/supporting chunks', () => {
  assert.equal(cleanSourceFileName('https://cdn.test/My%20Slides.pdf?download=1'), 'My Slides');
  assert.equal(cleanSourceFileName('%E0%A4%A.pdf'), '%E0%A4%A');
  assert.equal(getCitationSourceType({ name: 'Lecture.pdf', uri: 'x', isExam: false }), 'lecture');
  assert.equal(
    getCitationSourceType({ name: 'Practice Sheet.pdf', uri: 'x', isExam: true }),
    'exercise',
  );
  assert.equal(
    getCitationSourceType({ name: 'Mock Exam.pdf', uri: 'x', isExam: true }),
    'past_exam',
  );

  const chunks: LectureFileChunk[] = [
    { id: 'lecture-1', lectureId: 'lecture', lectureFileId: 'file-a', pageNumber: 1, chunkIndex: 0, content: 'alpha beta gamma', sourceType: 'lecture' },
    { id: 'lecture-2', lectureId: 'lecture', lectureFileId: 'file-a', pageNumber: 2, chunkIndex: 1, content: 'delta epsilon', sourceType: 'lecture' },
    { id: 'exercise-1', lectureId: 'lecture', lectureFileId: 'file-b', pageNumber: 1, chunkIndex: 2, content: 'worked exercise alpha', sourceType: 'exercise' },
    { id: 'exam-1', lectureId: 'lecture', lectureFileId: 'file-c', pageNumber: 1, chunkIndex: 3, content: 'past exam alpha', sourceType: 'past_exam' },
  ];

  assert.deepEqual(
    balanceCitationChunks(chunks, 3, 'worked exercise alpha').map((chunk) => chunk.id),
    ['lecture-1', 'lecture-2', 'exercise-1'],
  );
  assert.deepEqual(balanceCitationChunks([chunks[2], chunks[3]], 1).map((chunk) => chunk.id), [
    'exercise-1',
  ]);
});

test('study flow helpers build reusable labels, prep content, and summary text', () => {
  assert.equal(getModeLabel('beginner'), 'Beginner');
  assert.equal(getModeLabel('exam'), 'Exam');
  assert.equal(getModeLabel('normal'), 'Normal');

  const prep = buildStudyPrepContent('beginner', 'Derivatives', ['limits', 'slope'], t, 'formula proof');
  assert.equal(prep.primer.length, 3);
  assert.equal(prep.conceptMap.length, 2);
  assert.ok(prep.workedExample);
  assert.equal(buildStudyPrepContent('normal', 'History', [], t).workedExample, undefined);
  assert.match(buildSocraticHint(null, t), /study\.socraticHintDefault/);
  assert.match(buildSocraticHint({ id: 'q1', prompt: 'why?', checkType: 'why', targetConcepts: ['limits'] }, t), /limits/);
  assert.match(buildSocraticHint({ id: 'q2', prompt: 'why?', checkType: 'why' }, t), /study\.socraticHintWhy/);
  assert.match(buildSocraticHint({ id: 'q3', prompt: 'apply?', checkType: 'apply' }, t), /study\.socraticHintApply/);
  assert.match(buildSocraticHint({ id: 'q4', prompt: 'transfer?', checkType: 'transfer' }, t), /study\.socraticHintTransfer/);
  assert.match(buildSocraticHint({ id: 'q5', prompt: 'teach?', checkType: 'teach_back' }, t), /study\.socraticHintTeachBack/);
  assert.match(buildSocraticHint({ id: 'q6', prompt: 'recall?', checkType: 'recall', targetConcepts: ['limits'] }, t), /limits/);

  const summary = buildSessionSummaryText({
    t,
    topic: 'Derivatives',
    warmupAnswers: [
      {
        questionId: 'warmup-1',
        prompt: 'What is a derivative?',
        selectedOptionIndex: 0,
        correctOptionIndex: 0,
        correct: true,
        explanation: 'Correct',
      },
    ],
    finalQuizAnswers: [{ questionId: 'q1', prompt: 'Explain', score: 95, summary: 'Strong' }],
    finalQuizAverage: 95,
    mistakes: [{ id: 'm1', concept: 'chain rule', note: 'Needs review', source: 'recall' }],
  });
  assert.match(summary, /study\.endSummaryTitle/);
  assert.match(summary, /chain rule/);

  const emptySummary = buildSessionSummaryText({
    t,
    topic: 'History',
    warmupAnswers: [],
    finalQuizAnswers: [],
    mistakes: [],
  });
  assert.match(emptySummary, /study\.endSummaryNoWarmup/);
  assert.match(emptySummary, /study\.endSummaryNoWeakSpots/);
});

test('warmup options shuffle preserves the correct answer and repeated tutor text collapses', () => {
  const question = shuffleStudyWarmupOptions({
    id: 'warmup-1',
    prompt: 'Pick the definition',
    options: ['correct', 'wrong 1', 'wrong 2', 'wrong 3'],
    correctOptionIndex: 0,
    explanation: 'Because',
  });

  assert.equal(question.options[question.correctOptionIndex], 'correct');
  assert.equal(
    collapseRepeatedTutorText('First paragraph.\n\nSecond paragraph.\n\nFirst paragraph.\n\nSecond paragraph.'),
    'First paragraph.\n\nSecond paragraph.',
  );
  assert.equal(collapseRepeatedTutorText('Single paragraph.'), 'Single paragraph.');
  assert.equal(
    collapseRepeatedTutorText('First paragraph.\n\nSecond paragraph.\n\nDifferent paragraph.\n\nSecond paragraph.'),
    'First paragraph.\n\nSecond paragraph.\n\nDifferent paragraph.\n\nSecond paragraph.',
  );
});
