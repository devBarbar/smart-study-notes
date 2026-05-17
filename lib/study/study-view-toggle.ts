import type { StudyPhase } from "./study-session-types";

export type StudySessionSurface = "chat" | "canvas";
export type StudySessionSurfacePreference = StudySessionSurface | null;

export const hasCanvasStudySurface = (
  studyPhase: StudyPhase,
  grading: boolean,
) =>
  studyPhase === "guided_notes" ||
  studyPhase === "answer" ||
  // Keep the canvas mounted while the session is in the grading phase even
  // after the grading boolean flips back to false. The freshly-inserted
  // feedback block is rendered on the canvas, and unmounting the Skia surface
  // mid-write crashed on iOS and dropped the canvasPages save before the new
  // visual block could be persisted.
  studyPhase === "grading" ||
  grading;

export const resolveStudySessionSurface = ({
  studyPhase,
  grading,
  preferredSurface,
}: {
  studyPhase: StudyPhase;
  grading: boolean;
  preferredSurface: StudySessionSurfacePreference;
}): StudySessionSurface => {
  if (grading) {
    return "canvas";
  }

  if (!hasCanvasStudySurface(studyPhase, grading)) {
    return "chat";
  }

  return preferredSurface === "chat" ? "chat" : "canvas";
};

export const toggleStudySessionSurface = (
  currentSurface: StudySessionSurface,
  canvasAvailable: boolean,
): StudySessionSurfacePreference => {
  if (!canvasAvailable) {
    return null;
  }

  return currentSurface === "canvas" ? "chat" : "canvas";
};
