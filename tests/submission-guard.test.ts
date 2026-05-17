import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionGate } from "../lib/study/submission-guard";

test("submission gate allows only one in-flight submit", () => {
  const gate = createSubmissionGate();

  assert.equal(gate.isLocked(), false);
  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.isLocked(), true);
  assert.equal(gate.tryEnter(), false);

  gate.leave();
  assert.equal(gate.isLocked(), false);
  assert.equal(gate.tryEnter(), true);
});
