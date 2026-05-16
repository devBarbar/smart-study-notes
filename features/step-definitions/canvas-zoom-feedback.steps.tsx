import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { fireEvent, render } from '@testing-library/react-native/pure';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  getCanvasZoomPercentLabel,
  getNextCanvasZoom,
  scaleCanvasZoomByPinch,
} from '../../lib/canvas-zoom';
import {
  buildCanvasFeedbackData,
  estimateCanvasFeedbackBlockSize,
  getCanvasFeedbackToneColor,
  insertCanvasFeedbackBlockBelowAnswer,
} from '../../lib/study/canvas-feedback';
import { buildInitialCanvasPage } from '../../lib/study/study-canvas-pages';
import { StudyFeedback } from '../../types';
import { AppWorld } from '../support/world';

const CanvasZoomHarness = () => {
  const [zoom, setZoom] = useState(1);
  const [strokeCount, setStrokeCount] = useState(0);

  return (
    <View>
      <Text testID="zoom-label">{getCanvasZoomPercentLabel(zoom)}</Text>
      <Text testID="stroke-count">{strokeCount}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom out"
        onPress={() => setZoom((current) => getNextCanvasZoom(current, 'out'))}
      >
        <Text>Zoom out</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Zoom in"
        onPress={() => setZoom((current) => getNextCanvasZoom(current, 'in'))}
      >
        <Text>Zoom in</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset zoom"
        onPress={() => setZoom((current) => getNextCanvasZoom(current, 'reset'))}
      >
        <Text>Reset zoom</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pinch larger"
        onPress={() => {
          setZoom((current) => scaleCanvasZoomByPinch(current, 1.5));
          setStrokeCount((current) => current);
        }}
      >
        <Text>Pinch larger</Text>
      </Pressable>
    </View>
  );
};

const gradingPresets: Record<string, { feedback: StudyFeedback; passed: boolean }> = {
  failed: {
    passed: false,
    feedback: {
      summary: 'The answer misses a causal link.',
      correctness: 'incorrect',
      score: 50,
      whatWentWrong: ['Missing the key cause'],
      correctAnswer: 'Name the cause and explain why it changes the result.',
      rewriteExample: 'The key cause is X, so the result changes because Y.',
    },
  },
  passed: {
    passed: true,
    feedback: {
      summary: 'The answer is complete.',
      correctness: 'correct',
      score: 94,
      whatWentRight: ['Named the key idea'],
      whatWentWrong: [],
    },
  },
};

const InlineFeedbackHarness = ({
  preset,
}: {
  preset: keyof typeof gradingPresets;
}) => {
  const [visible, setVisible] = useState(false);
  const selected = gradingPresets[preset];
  const data = buildCanvasFeedbackData(selected.feedback, selected.passed);
  const size = estimateCanvasFeedbackBlockSize(data);
  const inserted = insertCanvasFeedbackBlockBelowAnswer({
    pages: [buildInitialCanvasPage('page-1')],
    pageId: 'page-1',
    messageId: `feedback-${preset}`,
    feedback: selected.feedback,
    isPassed: selected.passed,
    answerBounds: { x: 40, y: 620, width: 280, height: 90 },
    id: `feedback-block-${preset}`,
    createdAt: '2026-05-16T00:00:00.000Z',
  });
  const color = getCanvasFeedbackToneColor(data.status);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Write feedback"
        onPress={() => setVisible(true)}
      >
        <Text>Write feedback</Text>
      </Pressable>
      {visible && (
        <View testID="canvas-feedback" style={{ borderColor: color }}>
          <Text testID="feedback-color">{color}</Text>
          <Text testID="feedback-height">{size.height}</Text>
          <Text testID="feedback-page-height">{inserted.pages[0].height}</Text>
          <Text>{data.summary}</Text>
          {data.whatWentRight.map((item) => (
            <Text key={`right-${item}`}>{item}</Text>
          ))}
          {data.whatWentWrong.map((item) => (
            <Text key={`wrong-${item}`}>{item}</Text>
          ))}
        </View>
      )}
    </View>
  );
};

Given('the study canvas zoom harness is open', function (this: AppWorld) {
  this.screen = render(<CanvasZoomHarness />);
});

Given(
  'the inline grading harness has a {word} answer',
  function (this: AppWorld, preset: keyof typeof gradingPresets) {
    assert.ok(gradingPresets[preset], `Unknown grading preset: ${preset}`);
    this.screen = render(<InlineFeedbackHarness preset={preset} />);
  },
);

When('the student zooms out', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Zoom out'));
});

When('the student zooms in', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Zoom in'));
});

When('the student resets zoom', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Reset zoom'));
});

When('the student pinches the canvas larger', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Pinch larger'));
});

When('the tutor writes feedback below the answer', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Write feedback'));
});

Then('the canvas zoom reads {string}', function (this: AppWorld, label: string) {
  assert.equal(this.screen!.getByTestId('zoom-label').props.children, label);
});

Then('no handwriting stroke is created', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('stroke-count').props.children, 0);
});

Then('the canvas feedback is red', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('feedback-color').props.children, '#dc2626');
});

Then('the canvas feedback is green', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('feedback-color').props.children, '#16a34a');
});

Then(
  'the canvas feedback includes {string}',
  function (this: AppWorld, text: string) {
    assert.ok(this.screen!.getByText(text));
  },
);
