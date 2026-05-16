import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { filterChangedLinesToSource } = require('../scripts/changed-coverage-files');

test('changed coverage targets ignore blank source lines', () => {
  const directory = mkdtempSync(join(tmpdir(), 'changed-coverage-'));
  const filePath = join(directory, 'source.ts');

  try {
    writeFileSync(filePath, 'const covered = true;\n\nreturn covered;\n');

    assert.deepEqual(filterChangedLinesToSource(filePath, [1, 2, 3, 4]), [1, 3]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
