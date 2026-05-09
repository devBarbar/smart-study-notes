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
  "targetConcepts": ["Concept A"],
  "expectedAnswerPoints": ["Name the input", "Explain the output"]
}
\`\`\``);

    assert.equal(parsed.text, 'Short explanation.\n\nWhat is the next step?');
    assert.deepEqual(parsed.tutorQuestion, {
      question: 'What is the next step?',
      targetConcepts: ['Concept A'],
      expectedAnswerPoints: ['Name the input', 'Explain the output'],
    });
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
