import { CanvasStageKind } from '../../types';

export const CHAT_ITEM_HEIGHT = 100;
export const MEMORIZATION_SECONDS = 120;
export const WARMUP_QUESTION_COUNT = 10;
export const FINAL_QUIZ_QUESTION_COUNT = 5;

export const INITIAL_CANVAS_WIDTH = 1400;
export const INITIAL_CANVAS_HEIGHT = 760;
export const CANVAS_GROW_CHUNK = 600;
export const EDGE_THRESHOLD = 80;

export const STAGE_LABELS: Record<CanvasStageKind, string> = {
  guided_notes: 'Guided notes',
  answer: 'Answer',
  recall: 'Recall',
  final_quiz: 'Final quiz',
  diagnostic: 'Diagnostic',
};
