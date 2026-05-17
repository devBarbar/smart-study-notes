import assert from 'node:assert/strict';
import test from 'node:test';

const loadOpenAIShared = async () => {
  return await import('../supabase/functions/_shared/json');
};

test('stripCodeFences extracts prose-wrapped grading JSON', async () => {
  const { stripCodeFences } = await loadOpenAIShared();
  const cleaned = stripCodeFences(`Let's work on this together.

{
  "summary": "The main gap is memory placement.",
  "correctness": "partially correct",
  "score": 30,
  "whatWentRight": [
    "Identified the ALU and Control Unit."
  ],
  "rubric": {
    "clarity": 40
  }
}`);

  const parsed = JSON.parse(cleaned);
  assert.equal(parsed.summary, 'The main gap is memory placement.');
  assert.equal(parsed.correctness, 'partially correct');
  assert.equal(parsed.rubric.clarity, 40);
});

test('stripCodeFences keeps non-json prose intact', async () => {
  const { stripCodeFences } = await loadOpenAIShared();

  assert.equal(
    stripCodeFences('No structured payload here: just tutor text.'),
    'No structured payload here: just tutor text.',
  );
});

test('stripCodeFences ignores braces inside quoted JSON strings', async () => {
  const { stripCodeFences } = await loadOpenAIShared();
  const cleaned = stripCodeFences(
    'Lead-in {"summary":"Use the {CPU} label and say \\"memory\\".","whatWentWrong":["Braces in text are not objects."]}',
  );

  const parsed = JSON.parse(cleaned);
  assert.equal(parsed.summary, 'Use the {CPU} label and say "memory".');
  assert.deepEqual(parsed.whatWentWrong, ['Braces in text are not objects.']);
});
