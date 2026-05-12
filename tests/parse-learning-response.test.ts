import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLearningResponse } from '../lib/parse-learning-response';

describe('parseLearningResponse', () => {
  it('removes learning question metadata and returns structured data', () => {
    const parsed = parseLearningResponse(`Short explanation.

What is the next step?

\`\`\`learning_question
{
  "question": "What is the next step?",
  "checkType": "apply",
  "requiredForPass": true,
  "difficulty": "exam",
  "targetConcepts": ["Concept A"],
  "expectedAnswerPoints": ["Name the input", "Explain the output"]
}
\`\`\``);

    assert.equal(parsed.text, 'Short explanation.\n\nWhat is the next step?');
    assert.deepEqual(parsed.tutorQuestion, {
      question: 'What is the next step?',
      targetConcepts: ['Concept A'],
      expectedAnswerPoints: ['Name the input', 'Explain the output'],
      checkType: 'apply',
      requiredForPass: true,
      difficulty: 'exam',
    });
  });

  it('handles learning question fences with extra labels', () => {
    const parsed = parseLearningResponse(`Explanation.

Teach it back?

\`\`\`learning_question JSON
{"question":"Teach it back?","checkType":"teach_back","requiredForPass":true,"difficulty":"basic","assessmentKind":"depth"}
\`\`\``);

    assert.equal(parsed.text, 'Explanation.\n\nTeach it back?');
    assert.equal(parsed.tutorQuestion?.question, 'Teach it back?');
    assert.equal(parsed.tutorQuestion?.checkType, 'teach_back');
    assert.equal(parsed.tutorQuestion?.assessmentKind, 'depth');
  });

  it('removes generic json code fences only when they contain tutor metadata', () => {
    const parsed = parseLearningResponse(`Why does this happen?

\`\`\`json
{"question":"Why does this happen?","checkType":"why","requiredForPass":true}
\`\`\``);

    assert.equal(parsed.text, 'Why does this happen?');
    assert.equal(parsed.tutorQuestion?.question, 'Why does this happen?');
    assert.equal(parsed.tutorQuestion?.checkType, 'why');
  });

  it('removes trailing raw tutor metadata JSON', () => {
    const parsed = parseLearningResponse(`Explain the scheduler in your own words.
{"question":"Explain the scheduler in your own words.","checkType":"recall","requiredForPass":true,"difficulty":"basic","assessmentKind":"depth"}`);

    assert.equal(parsed.text, 'Explain the scheduler in your own words.');
    assert.equal(parsed.tutorQuestion?.question, 'Explain the scheduler in your own words.');
    assert.equal(parsed.tutorQuestion?.assessmentKind, 'depth');
  });

  it('keeps ordinary json code blocks visible', () => {
    const parsed = parseLearningResponse(`Here is an example:

\`\`\`json
{"name":"Ada"}
\`\`\``);

    assert.equal(parsed.text, `Here is an example:

\`\`\`json
{"name":"Ada"}
\`\`\``);
    assert.equal(parsed.tutorQuestion, undefined);
  });

  it('ignores invalid metadata without dropping visible text', () => {
    const parsed = parseLearningResponse(`Visible text.

\`\`\`learning_question
not json
\`\`\``);

    assert.equal(parsed.text, 'Visible text.');
    assert.equal(parsed.tutorQuestion, undefined);
  });
});
