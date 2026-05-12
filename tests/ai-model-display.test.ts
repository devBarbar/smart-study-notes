import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { formatAIModelBadge } from '../lib/ai-model-display';

test('formats tutor model badges with provider and model', () => {
  assert.equal(
    formatAIModelBadge('openai/gpt-5.5', 'openrouter'),
    'OpenRouter / openai/gpt-5.5',
  );
  assert.equal(formatAIModelBadge('gpt-5.5', 'openai'), 'OpenAI / gpt-5.5');
  assert.equal(formatAIModelBadge('  gpt-5.5  ', null), 'gpt-5.5');
  assert.equal(formatAIModelBadge('', 'openai'), null);
});

test('tutor chat passes model metadata from job result into the message UI', () => {
  const streamSource = readFileSync(path.join(process.cwd(), 'lib', 'openai.ts'), 'utf8');
  const studySource = readFileSync(
    path.join(process.cwd(), 'app', 'study', '[sessionId].tsx'),
    'utf8',
  );
  const messageSource = readFileSync(
    path.join(process.cwd(), 'components', 'study', 'study-chat-message.tsx'),
    'utf8',
  );
  const processJobSource = readFileSync(
    path.join(process.cwd(), 'supabase', 'functions', 'process-job', 'index.ts'),
    'utf8',
  );

  assert.match(streamSource, /model:\s*row\.result\?\.model/);
  assert.match(streamSource, /aiPlatform:\s*row\.result\?\.platform/);
  assert.match(streamSource, /usage:\s*row\.result\?\.usage/);
  assert.match(streamSource, /reasoningEffort:\s*row\.result\?\.reasoningEffort/);
  assert.match(studySource, /aiModel:\s*result\.model\s*\?\?/);
  assert.match(studySource, /aiPlatform:\s*result\.aiPlatform\s*\?\?/);
  assert.match(studySource, /reasoning:\s*\{/);
  assert.match(messageSource, /ai-model-badge-\$\{item\.id\}/);
  assert.match(messageSource, /ai-reasoning-badge-\$\{item\.id\}/);
  assert.match(processJobSource, /model:\s*reply\.model/);
  assert.match(processJobSource, /platform:\s*reply\.platform/);
  assert.match(processJobSource, /usage:\s*reply\.usage/);
  assert.match(processJobSource, /reasoningEffort:\s*reply\.reasoningEffort/);
});
