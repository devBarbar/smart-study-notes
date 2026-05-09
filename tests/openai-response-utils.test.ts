import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmbeddingRequestBody,
  extractResponseText,
  getCompletedResponse,
  getResponseTextDelta,
  parseSseDataLine,
  toTokenUsage,
  validateEmbeddingDimensions,
} from '../supabase/functions/_shared/openai-response-utils';

test('extractResponseText reads output_text from Responses API response', () => {
  const text = extractResponseText({
    output_text: 'direct text',
    output: [],
  });

  assert.equal(text, 'direct text');
});

test('extractResponseText falls back to output content parts', () => {
  const text = extractResponseText({
    output: [
      {
        content: [
          { type: 'output_text', text: 'hello ' },
          { type: 'output_text', text: 'world' },
        ],
      },
    ],
  });

  assert.equal(text, 'hello world');
});

test('toTokenUsage maps Responses token fields to existing usage shape', () => {
  const usage = toTokenUsage({
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
    },
  });

  assert.deepEqual(usage, {
    promptTokens: 11,
    completionTokens: 7,
    totalTokens: 18,
  });
});

test('Responses stream helpers parse text delta and completed response', () => {
  const deltaEvent = parseSseDataLine(
    'data: {"type":"response.output_text.delta","delta":"partial"}',
  );
  const completedEvent = parseSseDataLine(
    'data: {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
  );

  assert.equal(getResponseTextDelta(deltaEvent), 'partial');
  assert.deepEqual(getCompletedResponse(completedEvent), {
    model: 'gpt-5.5',
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  });
});

test('buildEmbeddingRequestBody includes 1536 dimensions for text-embedding-3-large', () => {
  assert.deepEqual(
    buildEmbeddingRequestBody('text-embedding-3-large', ['hello'], 1536),
    {
      model: 'text-embedding-3-large',
      input: ['hello'],
      dimensions: 1536,
    },
  );
});

test('validateEmbeddingDimensions throws on length mismatch', () => {
  assert.throws(
    () => validateEmbeddingDimensions([[0.1, 0.2]], 1536),
    /Embedding 0 has 2 dimensions; expected 1536/,
  );
});
