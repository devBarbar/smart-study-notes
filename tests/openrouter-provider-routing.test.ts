import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('OpenRouter chat requests prefer Nitro-style throughput routing', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'supabase', 'functions', '_shared', 'openai.ts'),
    'utf8',
  );

  assert.match(source, /OPENROUTER_PROVIDER_PREFERENCES\s*=\s*\{\s*sort:\s*"throughput"\s*\}/);
  assert.match(source, /provider:\s*OPENROUTER_PROVIDER_PREFERENCES/);
});
