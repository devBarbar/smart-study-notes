import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCheatSheetEvidenceHash,
  buildCheatSheetHtml,
  parseCheatSheetContent,
} from '../lib/cheat-sheet';

test('parseCheatSheetContent strips fences and limits sections and items', () => {
  const raw = `\`\`\`json
{
  "title": "Exam Gaps",
  "summary": "Focus on proofs.",
  "sections": [
    {"title":"A","items":[
      {"title":"One","gap":"Missing definition","fix":"State it first","priority":91},
      {"title":"Two","gap":"Weak example","fix":"Use a numeric case"},
      {"title":"Three","gap":"Too vague","fix":"Name the condition"},
      {"title":"Four","gap":"No conclusion","fix":"Finish the argument"},
      {"title":"Five","gap":"Extra","fix":"Extra"}
    ]},
    {"title":"B","items":[{"title":"B1","gap":"gap","fix":"fix"}]},
    {"title":"C","items":[{"title":"C1","gap":"gap","fix":"fix"}]},
    {"title":"D","items":[{"title":"D1","gap":"gap","fix":"fix"}]},
    {"title":"E","items":[{"title":"E1","gap":"gap","fix":"fix"}]}
  ]
}
\`\`\``;

  const parsed = parseCheatSheetContent(raw);
  assert.equal(parsed.title, 'Exam Gaps');
  assert.equal(parsed.sections.length, 4);
  assert.equal(parsed.sections[0].items.length, 4);
  assert.equal(parsed.sections[0].items[0].priority, 91);
});

test('buildCheatSheetEvidenceHash is stable across ordering changes', () => {
  const first = buildCheatSheetEvidenceHash([
    { questionText: 'Q2', answerText: 'A2', score: 40, correctness: 'incorrect' },
    { questionText: 'Q1', answerText: 'A1', score: 80, correctness: 'partially correct' },
  ]);
  const second = buildCheatSheetEvidenceHash([
    { questionText: 'Q1', answerText: 'A1', score: 80, correctness: 'partially correct' },
    { questionText: 'Q2', answerText: 'A2', score: 40, correctness: 'incorrect' },
  ]);
  assert.equal(first, second);
});

test('buildCheatSheetHtml escapes text and uses A4 layout', () => {
  const html = buildCheatSheetHtml({
    title: 'Cheat <Sheet>',
    summary: 'Use x < y',
    sections: [
      {
        title: 'Core',
        items: [{ title: 'Limit', gap: 'Forgot <epsilon>', fix: 'Write & quantify' }],
      },
    ],
  });

  assert.match(html, /@page \{ size: A4/);
  assert.match(html, /Cheat &lt;Sheet&gt;/);
  assert.match(html, /Forgot &lt;epsilon&gt;/);
  assert.match(html, /Write &amp; quantify/);
});

