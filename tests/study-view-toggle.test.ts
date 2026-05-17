import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasCanvasStudySurface,
  resolveStudySessionSurface,
  toggleStudySessionSurface,
} from "../lib/study/study-view-toggle";

test("study session surface defaults to canvas only when canvas work is active", () => {
  assert.equal(hasCanvasStudySurface("answer", false), true);
  assert.equal(hasCanvasStudySurface("guided_notes", false), true);
  assert.equal(hasCanvasStudySurface("tutor", true), true);
  assert.equal(hasCanvasStudySurface("tutor", false), false);
  assert.equal(hasCanvasStudySurface("grading", false), true);

  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "answer",
      grading: false,
      preferredSurface: null,
    }),
    "canvas",
  );
  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "tutor",
      grading: false,
      preferredSurface: "canvas",
    }),
    "chat",
  );
});

test("study session surface toggle switches between chat and canvas without changing phase", () => {
  assert.equal(toggleStudySessionSurface("canvas", true), "chat");
  assert.equal(toggleStudySessionSurface("chat", true), "canvas");
  assert.equal(toggleStudySessionSurface("chat", false), null);

  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "answer",
      grading: false,
      preferredSurface: toggleStudySessionSurface("canvas", true),
    }),
    "chat",
  );
  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "answer",
      grading: false,
      preferredSurface: toggleStudySessionSurface("chat", true),
    }),
    "canvas",
  );
});

test("grading forces the canvas surface even when chat was previously selected", () => {
  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "grading",
      grading: true,
      preferredSurface: "chat",
    }),
    "canvas",
  );
});

test("canvas stays available after grading completes so feedback remains visible", () => {
  // Regression: when grading flips to false while studyPhase is still "grading"
  // (the window before the next tutor question transitions the phase), the
  // canvas surface must remain available. Otherwise the StudyCanvasPanel and
  // its Skia surface unmount mid-write, hiding the feedback block and dropping
  // the canvasPages save.
  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "grading",
      grading: false,
      preferredSurface: null,
    }),
    "canvas",
  );

  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "grading",
      grading: false,
      preferredSurface: "canvas",
    }),
    "canvas",
  );

  // The user can still opt back into chat after grading finishes.
  assert.equal(
    resolveStudySessionSurface({
      studyPhase: "grading",
      grading: false,
      preferredSurface: "chat",
    }),
    "chat",
  );
});
