import { v4 as uuid } from 'uuid';

import {
  CanvasBounds,
  CanvasFeedbackBlockData,
  CanvasPage,
  CanvasVisualBlock,
  StudyFeedback,
} from '../../types';
import { buildInitialCanvasPage } from './study-canvas-pages';

const FEEDBACK_WIDTH = 520;
const FEEDBACK_PADDING = 24;
const FEEDBACK_GAP = 32;
const FEEDBACK_LINE_HEIGHT = 22;
const FEEDBACK_SECTION_HEIGHT = 28;
const FEEDBACK_MIN_HEIGHT = 132;

export const CANVAS_FEEDBACK_PASS_COLOR = '#16a34a';
export const CANVAS_FEEDBACK_FAIL_COLOR = '#dc2626';

const normalizeList = (items?: string[]) =>
  Array.isArray(items)
    ? items
        .map((item) => normalizeOptionalText(item))
        .filter((item): item is string => Boolean(item))
    : [];

const normalizeOptionalText = (value: unknown) => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return undefined;
};

const normalizeScore = (score: unknown) =>
  typeof score === 'number' && Number.isFinite(score) ? score : undefined;

const lineCount = (text?: string) => {
  const trimmed = text?.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 56));
};

export const getCanvasFeedbackToneColor = (status: CanvasFeedbackBlockData['status']) => (status === 'passed' ? CANVAS_FEEDBACK_PASS_COLOR : CANVAS_FEEDBACK_FAIL_COLOR);

export const normalizeCanvasFeedbackBlockData = (
  data: Partial<CanvasFeedbackBlockData> | StudyFeedback | null | undefined,
  fallbackStatus: CanvasFeedbackBlockData['status'] = 'failed',
): CanvasFeedbackBlockData => {
  const record = (data ?? {}) as Record<string, unknown>;
  const status =
    record.status === 'passed' || record.status === 'failed'
      ? record.status
      : fallbackStatus;

  return {
    status,
    score: normalizeScore(record.score),
    summary: normalizeOptionalText(record.summary) || 'No summary',
    whatWentRight: normalizeList(record.whatWentRight as string[] | undefined),
    whatWentWrong: normalizeList(record.whatWentWrong as string[] | undefined),
    correctAnswer: normalizeOptionalText(record.correctAnswer),
    rewriteExample: normalizeOptionalText(record.rewriteExample),
  };
};

export const buildCanvasFeedbackData = (feedback: StudyFeedback, isPassed: boolean): CanvasFeedbackBlockData =>
  normalizeCanvasFeedbackBlockData(feedback, isPassed ? 'passed' : 'failed');

export const estimateCanvasFeedbackBlockSize = (data: CanvasFeedbackBlockData) => {
  let height = FEEDBACK_PADDING * 2 + 42;
  height += lineCount(data.summary) * FEEDBACK_LINE_HEIGHT;

  const sections = [data.whatWentRight, data.whatWentWrong].filter((items) => items.length > 0);
  for (const items of sections) {
    height += FEEDBACK_SECTION_HEIGHT + items.length * FEEDBACK_LINE_HEIGHT;
  }

  if (data.correctAnswer) {
    height += FEEDBACK_SECTION_HEIGHT + lineCount(data.correctAnswer) * FEEDBACK_LINE_HEIGHT;
  }

  if (data.rewriteExample) {
    height += FEEDBACK_SECTION_HEIGHT + lineCount(data.rewriteExample) * FEEDBACK_LINE_HEIGHT;
  }

  return {
    width: FEEDBACK_WIDTH,
    height: Math.max(FEEDBACK_MIN_HEIGHT, height),
  };
};

export const insertCanvasFeedbackBlockBelowAnswer = ({
  pages,
  pageId,
  messageId,
  feedback,
  isPassed,
  answerBounds,
  id = `feedback-${uuid()}`,
  createdAt = new Date().toISOString(),
}: {
  pages: CanvasPage[];
  pageId: string;
  messageId: string;
  feedback: StudyFeedback;
  isPassed: boolean;
  answerBounds?: CanvasBounds | null;
  id?: string;
  createdAt?: string;
}) => {
  const targetPage =
    pages.find((page) => page.id === pageId) ??
    pages[0] ??
    buildInitialCanvasPage(pageId || 'page-1');
  const sourcePages = pages.length > 0 ? pages : [targetPage];
  const fallbackY = targetPage ? Math.max(0, targetPage.height - 220) : 0;
  const data = buildCanvasFeedbackData(feedback, isPassed);
  const size = estimateCanvasFeedbackBlockSize(data);
  const position = {
    x: Math.max(answerBounds?.x ?? 40, 24),
    y: Math.max(
      (answerBounds ? answerBounds.y + answerBounds.height : fallbackY) +
        FEEDBACK_GAP,
      24,
    ),
  };
  const block: CanvasVisualBlock = {
    id,
    type: 'feedback',
    position,
    size,
    data,
    messageId,
    createdAt,
  };

  return {
    block,
    pages: sourcePages.map((page) => {
      if (page.id !== targetPage?.id) return page;
      const visualBlocks = [
        ...(page.visualBlocks ?? []).filter(
          (item) => item.messageId !== messageId || item.type !== 'feedback',
        ),
        block,
      ];
      return {
        ...page,
        visualBlocks,
        width: Math.max(page.width, position.x + size.width + FEEDBACK_GAP),
        height: Math.max(page.height, position.y + size.height + FEEDBACK_GAP),
      };
    }),
  };
};
