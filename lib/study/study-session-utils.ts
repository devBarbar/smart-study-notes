import { estimateVisualBlockSize } from '../parse-visual-response';
import {
  CanvasPage,
  CanvasVisualBlock as CanvasVisualBlockType,
  StudySession,
} from '../../types';

export const canvasPagesHaveWork = (pages?: CanvasPage[]) =>
  Boolean(
    pages?.some(
      (page) =>
        (page.strokes?.length ?? 0) > 0 ||
        (page.titleStrokes?.length ?? 0) > 0 ||
        (page.visualBlocks?.length ?? 0) > 0,
    ),
  );

export const sessionHasInProgressCanvasWork = (session: StudySession | null) =>
  Boolean(
    session?.lastQuestionId ||
      session?.notesText?.trim() ||
      (session?.canvasData?.length ?? 0) > 0 ||
      canvasPagesHaveWork(session?.canvasPages),
  );

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    const items = value.map(stableStringify).join(',');
    return `[${items}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? String(value);
};

export const getVisualBlockSignature = (
  block: Pick<CanvasVisualBlockType, 'type' | 'data'>,
) => `${block.type}:${stableStringify(block.data)}`;

export const getVisualBlockInsertKey = (
  pageId: string,
  messageId: string,
  block: Pick<CanvasVisualBlockType, 'type' | 'data'>,
) => `${pageId}:${messageId}:${getVisualBlockSignature(block)}`;

export const getVisualBlockBottom = (block: CanvasVisualBlockType) =>
  block.position.y +
  (block.size?.height ?? estimateVisualBlockSize(block).height);

export const dedupeVisualBlocks = (blocks: CanvasVisualBlockType[] = []) => {
  const seen = new Set<string>();
  const deduped = blocks.filter((block) => {
    const key = `${block.messageId}:${getVisualBlockSignature(block)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped;
};

export const normalizeCanvasPageVisualBlocks = (pages: CanvasPage[]) => {
  let changed = false;
  const normalizedPages = pages.map((page) => {
    if (!page.visualBlocks || page.visualBlocks.length === 0) {
      return page;
    }

    const dedupedBlocks = dedupeVisualBlocks(page.visualBlocks);
    if (dedupedBlocks.length === page.visualBlocks.length) {
      return page;
    }

    changed = true;
    return {
      ...page,
      visualBlocks: dedupedBlocks,
    };
  });

  return { changed, pages: normalizedPages };
};

export const estimateTokenCount = (text: string) => {
  const compact = text.trim();
  if (!compact) return 0;
  return Math.max(1, Math.ceil(compact.length / 4));
};
