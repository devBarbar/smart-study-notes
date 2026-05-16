import { act } from '@testing-library/react-native';
import React, { createRef } from 'react';
import { measureRenders } from 'reassure';

import {
  CanvasStroke,
  HandwritingCanvas,
  HandwritingCanvasHandle,
} from '@/components/handwriting-canvas.native';

const buildStroke = (strokeIndex: number, points = 24): CanvasStroke => ({
  color: strokeIndex % 2 === 0 ? '#0f172a' : '#2563eb',
  width: 3 + (strokeIndex % 3),
  points: Array.from({ length: points }, (_, pointIndex) => ({
    x: 24 + pointIndex * 8,
    y: 32 + strokeIndex * 18 + Math.sin(pointIndex / 2) * 6,
  })),
});

const buildCanvasStrokes = (count: number) =>
  Array.from({ length: count }, (_, index) => buildStroke(index));

test('HandwritingCanvas renders dense handwriting and updates stroke data', async () => {
  const ref = createRef<HandwritingCanvasHandle>();
  const initialStrokes = buildCanvasStrokes(36);
  const nextStrokes = [...initialStrokes, buildStroke(37, 32)];

  await measureRenders(
    <HandwritingCanvas
      ref={ref}
      width={1024}
      height={1400}
      strokeColor="#0f172a"
      initialStrokes={initialStrokes}
      onStrokesChange={jest.fn()}
    />,
    {
      scenario: async () => {
        await act(async () => {
          ref.current?.setStrokes(nextStrokes);
        });
      },
    },
  );
});
