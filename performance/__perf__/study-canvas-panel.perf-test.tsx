import { fireEvent, screen } from '@testing-library/react-native';
import React, { createRef } from 'react';
import { measureRenders } from 'reassure';

import {
  HandwritingCanvasHandle,
  type CanvasStroke,
} from '@/components/handwriting-canvas';
import { StudyCanvasPanel } from '@/components/study/study-canvas-panel';
import { Colors } from '@/constants/theme';
import { CanvasPage } from '@/types';

const styles = new Proxy(
  {},
  {
    get: () => ({}),
  },
) as any;

const t = (key: string, params?: Record<string, unknown>) =>
  params?.number ? `${key}-${params.number}` : key;

const buildStroke = (strokeIndex: number): CanvasStroke => ({
  color: '#0f172a',
  width: 3,
  points: Array.from({ length: 18 }, (_, pointIndex) => ({
    x: 20 + pointIndex * 10,
    y: 40 + strokeIndex * 16 + (pointIndex % 3) * 4,
  })),
});

const activePage: CanvasPage = {
  id: 'page-1',
  titleStrokes: [],
  strokes: [],
  visualBlocks: [],
  stageKind: 'answer',
  stageLabel: 'Answer',
  stagePageNumber: 1,
};

const defaultProps = {
  styles,
  palette: Colors.light,
  t,
  tutorCollapsed: false,
  toggleTutor: jest.fn(),
  studyTitle: 'Photosynthesis',
  studyOutline: 'Light reactions, Calvin cycle, and limiting factors.',
  studyPlanEntry: null,
  canvasPages: [activePage],
  activePageId: activePage.id,
  activePage,
  canvasSize: { width: 1024, height: 1400 },
  canvasMode: 'pen' as const,
  canvasColor: '#0f172a',
  onCanvasModeChange: jest.fn(),
  onCanvasColorChange: jest.fn(),
  onClearCanvas: jest.fn(),
  onUndo: jest.fn(),
  onAddPage: jest.fn(),
  onSelectPage: jest.fn(),
  onTitleStrokesChange: jest.fn(),
  titleCanvasRef: createRef<HandwritingCanvasHandle>(),
  canvasRef: createRef<HandwritingCanvasHandle>(),
  pageScrollRef: createRef<any>(),
  canvasScrollRef: createRef<any>(),
  canvasHScrollRef: createRef<any>(),
  scrollEnabled: true,
  onDrawingStart: jest.fn(),
  onDrawingEnd: jest.fn(),
  initialCanvasStrokes: Array.from({ length: 28 }, (_, index) =>
    buildStroke(index),
  ),
  onCanvasStrokesChange: jest.fn(),
  activeVisualBlocks: [],
  highlightedVisualBlockId: null,
  onHighlightVisualBlock: jest.fn(),
  highlightedAnswerLinkId: null,
  highlightedBounds: null,
  onCanvasLayout: jest.fn(),
  checkButtonPosition: null,
  checkButtonAnimatedStyle: {},
  lastDrawingPosition: null,
  onSubmitAnswer: jest.fn(),
  grading: false,
  answerMarkers: [],
  onMarkerPress: jest.fn(),
  answerText: 'Initial typed notes about light absorption.',
  onNotesChange: jest.fn(),
  references: [],
  onOpenCitation: jest.fn(),
  depthProgressItems: [],
  onRevealRecallHint: jest.fn(),
  onReplayGuidedAudio: jest.fn(),
  onStopGuidedAudio: jest.fn(),
};

test('StudyCanvasPanel keeps canvas and typed notes responsive', async () => {
  await measureRenders(<StudyCanvasPanel {...defaultProps} />, {
    scenario: async () => {
      fireEvent.changeText(
        screen.getByPlaceholderText('study.notesPlaceholder'),
        'Expanded typed notes about pigments and electron transport.',
      );
    },
  });
});
