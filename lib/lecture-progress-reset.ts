export type LectureProgressCounts = {
  sessions: number;
  flashcards: number;
  practiceExams: number;
  cheatSheets: number;
};

export const LECTURE_PROGRESS_RESET_RPC = 'reset_lecture_progress';

export const getLectureProgressResetInvalidationKeys = (lectureId: string) => [
  ['lectures'] as const,
  ['sessions'] as const,
  ['practice-exams', lectureId] as const,
  ['flashcards', lectureId] as const,
  ['flashcard-count', lectureId] as const,
];

export const emptyLectureProgressCounts: LectureProgressCounts = {
  sessions: 0,
  flashcards: 0,
  practiceExams: 0,
  cheatSheets: 0,
};
