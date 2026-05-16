import type { StudyPhase } from "./study-session-types";

export type StudySessionSurface = "chat" | "canvas";
export type StudySessionSurfacePreference = StudySessionSurface | null;

export const hasCanvasStudySurface = (
  studyPhase: StudyPhase,
  grading: boolean,
) => studyPhase === "guided_notes" || studyPhase === "answer" || grading;

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
