import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListeningNotesQuestion,
  buildGuidedAudioReplayFromMessage,
  getListeningNotesAudioText,
  shouldUseListeningNotesFlow,
} from "../lib/study/listening-notes-flow";
import { TutorQuestionMetadata } from "../types";

const depthQuestion: TutorQuestionMetadata = {
  question: "Explain the idea in your own words?",
  checkType: "why",
  requiredForPass: true,
  difficulty: "basic",
  assessmentKind: "depth",
  targetConcepts: ["core concept"],
  expectedAnswerPoints: ["definition", "reason"],
};

test("listening notes flow is used for depth tutor questions", () => {
  assert.equal(shouldUseListeningNotesFlow(depthQuestion), true);
  assert.equal(
    shouldUseListeningNotesFlow({
      ...depthQuestion,
      assessmentKind: undefined,
    }),
    true,
  );
  assert.equal(
    shouldUseListeningNotesFlow({
      ...depthQuestion,
      assessmentKind: "guided_notes",
    }),
    true,
  );
});

test("listening notes flow is skipped for diagnostic and final quiz questions", () => {
  assert.equal(
    shouldUseListeningNotesFlow({
      ...depthQuestion,
      assessmentKind: "diagnostic",
    }),
    false,
  );
  assert.equal(
    shouldUseListeningNotesFlow({
      ...depthQuestion,
      assessmentKind: "final_quiz",
    }),
    false,
  );
  assert.equal(shouldUseListeningNotesFlow(undefined), false);
  assert.equal(shouldUseListeningNotesFlow(null), false);
  assert.equal(
    shouldUseListeningNotesFlow({
      ...depthQuestion,
      question: undefined as unknown as string,
    }),
    false,
  );
  assert.equal(
    shouldUseListeningNotesFlow({ ...depthQuestion, question: "   " }),
    false,
  );
});

test("listening notes question preserves pass-counting depth metadata", () => {
  const question = buildListeningNotesQuestion(depthQuestion);

  assert.deepEqual(question, depthQuestion);
  assert.equal(question.assessmentKind, "depth");
  assert.equal(question.requiredForPass, true);
  assert.equal(question.checkType, "why");
});

test("listening notes audio removes the final check-in question when safe", () => {
  assert.equal(
    getListeningNotesAudioText(
      "Here is the explanation.\n\nExplain the idea in your own words?",
      "Explain the idea in your own words?",
    ),
    "Here is the explanation.",
  );
  assert.equal(
    getListeningNotesAudioText(
      "Why does it matter?\n\nBecause it controls the result.\n\nWhy does it matter?",
      "Why does it matter?",
    ),
    "Why does it matter?\n\nBecause it controls the result.",
  );
});

test("listening notes audio keeps text unchanged when removal is unsafe", () => {
  assert.equal(
    getListeningNotesAudioText(
      "The prompt is important: Explain the idea in your own words? Then compare it to the example.",
      "Explain the idea in your own words?",
    ),
    "The prompt is important: Explain the idea in your own words? Then compare it to the example.",
  );
  assert.equal(
    getListeningNotesAudioText("Explanation only.", ""),
    "Explanation only.",
  );
  assert.equal(
    getListeningNotesAudioText("Explanation only.", undefined),
    "Explanation only.",
  );
  assert.equal(
    getListeningNotesAudioText("Explanation only.", null),
    "Explanation only.",
  );
});

test("guided audio replay can be rebuilt from a restored tutor message", () => {
  const replay = buildGuidedAudioReplayFromMessage({
    id: "message-1",
    role: "ai",
    text: "First listen to the explanation. What caused the trade deficit?",
    tutorQuestion: {
      question: "What caused the trade deficit?",
      assessmentKind: "guided_notes",
      checkType: "why",
    },
  });

  assert.deepEqual(replay, {
    messageId: "message-1",
    text: "First listen to the explanation.",
  });
});

test("guided audio replay is not rebuilt without a guided tutor question", () => {
  assert.equal(
    buildGuidedAudioReplayFromMessage({
      id: "message-1",
      role: "ai",
      text: "Diagnostic setup.",
      tutorQuestion: {
        question: "What do you already know?",
        assessmentKind: "diagnostic",
      },
    }),
    null,
  );
});
