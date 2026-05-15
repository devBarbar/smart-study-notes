import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCitationSnippet,
  groupPdfTextItemsIntoLines,
  splitTextIntoLineChunks,
} from '../lib/pdf-source';
import { StudyCitation } from '../types';

test('groupPdfTextItemsIntoLines preserves visual line order and token order', () => {
  const lines = groupPdfTextItemsIntoLines([
    { str: 'second', transform: [1, 0, 0, 1, 10, 700] },
    { str: 'line', transform: [1, 0, 0, 1, 58, 700] },
    { str: 'first', transform: [1, 0, 0, 1, 10, 720] },
    { str: 'line', transform: [1, 0, 0, 1, 48, 720] },
  ]);

  assert.deepEqual(lines, ['first line', 'second line']);
});

test('splitTextIntoLineChunks records source line ranges', () => {
  const chunks = splitTextIntoLineChunks(
    ['alpha beta', 'gamma delta', 'epsilon zeta', 'eta theta'].join('\n'),
    24,
    0,
  );

  assert.deepEqual(
    chunks.map(({ content, startLine, endLine }) => ({ content, startLine, endLine })),
    [
      { content: 'alpha beta\ngamma delta', startLine: 1, endLine: 2 },
      { content: 'epsilon zeta\neta theta', startLine: 3, endLine: 4 },
    ],
  );
});

test('buildCitationSnippet trims long chunk content for citation storage', () => {
  const snippet = buildCitationSnippet(`${'a'.repeat(20)}\n${'b'.repeat(20)}`, 25);

  assert.equal(snippet, `${'a'.repeat(20)}\nbbbb...`);
});

test('StudyCitation JSON keeps line-aware source metadata', () => {
  const citation: StudyCitation = {
    chunkId: 'chunk-1',
    lectureId: 'lecture-1',
    lectureFileId: 'file-1',
    pageNumber: 3,
    startLine: 12,
    endLine: 14,
    snippet: 'source excerpt',
    sourceType: 'lecture',
  };

  assert.deepEqual(JSON.parse(JSON.stringify(citation)), citation);
});
