import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSourceCitations } from '../lib/source-citations';

test('parseSourceCitations extracts hidden source citation blocks', () => {
  const parsed = parseSourceCitations(`Explanation text.

\`\`\`source_citations
{"sourceIds":["S2","s1","S2"]}
\`\`\``);

  assert.equal(parsed.text, 'Explanation text.');
  assert.deepEqual(parsed.sourceIds, ['S2', 'S1']);
});

test('parseSourceCitations accepts inline fallback markers and removes them', () => {
  const parsed = parseSourceCitations('This is backed by the scheduler notes [S3, S4].');

  assert.equal(parsed.text, 'This is backed by the scheduler notes.');
  assert.deepEqual(parsed.sourceIds, ['S3', 'S4']);
});

test('parseSourceCitations ignores invalid source ids', () => {
  const parsed = parseSourceCitations(`Text

\`\`\`source_citations
{"sourceIds":["S1","source-2","A3"]}
\`\`\``);

  assert.equal(parsed.text, 'Text');
  assert.deepEqual(parsed.sourceIds, ['S1']);
});

test('parseSourceCitations hides incomplete streaming citation fences', () => {
  const parsed = parseSourceCitations(`Visible answer

\`\`\`source_citations
{"source`);

  assert.equal(parsed.text, 'Visible answer');
  assert.deepEqual(parsed.sourceIds, []);
});
