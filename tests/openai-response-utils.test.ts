import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmbeddingRequestBody,
  extractChatCompletionText,
  extractResponseText,
  getChatCompletionStreamError,
  getChatCompletionTextDelta,
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

test('Chat completion helpers parse OpenRouter text and streaming chunks', () => {
  assert.equal(
    extractChatCompletionText({
      choices: [{ message: { content: 'final answer' } }],
    }),
    'final answer',
  );

  const chunk = parseSseDataLine(
    'data: {"object":"chat.completion.chunk","model":"moonshotai/kimi-k2.6","choices":[{"delta":{"content":"partial"}}]}',
  );
  assert.equal(getChatCompletionTextDelta(chunk), 'partial');

  const errorChunk = parseSseDataLine(
    'data: {"object":"chat.completion.chunk","error":{"message":"Provider disconnected"}}',
  );
  assert.equal(getChatCompletionStreamError(errorChunk), 'Provider disconnected');
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
