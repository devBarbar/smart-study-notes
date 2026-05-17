import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { render } from '@testing-library/react-native/pure';
import React from 'react';
import { Text, View } from 'react-native';

import { stripCodeFences } from '../../supabase/functions/_shared/json';
import { AppWorld } from '../support/world';

Given('prose-wrapped grading feedback from the model', function (this: AppWorld) {
  this.values.rawFeedback = `Let's work on this together.

{
  "summary": "The main gap is memory placement.",
  "correctness": "partially correct",
  "score": 30,
  "whatWentRight": ["Identified the ALU and Control Unit."],
  "whatWentWrong": ["Placed programs and data inside the CPU."]
}`;
});

When('the feedback is prepared for the student', function (this: AppWorld) {
  const feedback = JSON.parse(stripCodeFences(String(this.values.rawFeedback)));
  const displayText = [
    feedback.summary,
    ...(Array.isArray(feedback.whatWentRight) ? feedback.whatWentRight : []),
    ...(Array.isArray(feedback.whatWentWrong) ? feedback.whatWentWrong : []),
  ].join('\n');

  this.screen = render(
    <View>
      <Text testID="feedback-summary">{feedback.summary}</Text>
      <Text testID="feedback-display">{displayText}</Text>
    </View>,
  );
});

Then('the feedback summary is {string}', function (this: AppWorld, summary: string) {
  assert.equal(this.screen!.getByTestId('feedback-summary').props.children, summary);
});

Then('the feedback hides the raw key {string}', function (this: AppWorld, rawKey: string) {
  const displayText = this.screen!.getByTestId('feedback-display').props.children;
  assert.equal(String(displayText).includes(rawKey), false);
});
