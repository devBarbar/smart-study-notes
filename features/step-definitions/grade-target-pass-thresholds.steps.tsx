import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { render } from '@testing-library/react-native/pure';
import React from 'react';
import { Text, View } from 'react-native';

import { feedbackPassesDepthCheck } from '../../lib/depth-checks';
import { PlanSettings } from '../../types';
import { AppWorld } from '../support/world';

const GradeTargetPassHarness = ({
  targetGrade,
  score,
}: {
  targetGrade: PlanSettings['targetGrade'];
  score: number;
}) => {
  const passed = feedbackPassesDepthCheck(
    {
      summary: 'Checked answer',
      correctness: 'correct',
      score,
      canCountForPass: true,
    },
    targetGrade,
  );

  return (
    <View>
      <Text testID="pass-status">{passed ? 'passed' : 'not passed'}</Text>
    </View>
  );
};

Given('the learner selected target grade {word}', function (this: AppWorld, targetGrade: string) {
  this.values.targetGrade = targetGrade;
});

When('the learner receives a score of {int}', function (this: AppWorld, score: number) {
  this.screen = render(
    <GradeTargetPassHarness
      targetGrade={this.values.targetGrade as PlanSettings['targetGrade']}
      score={score}
    />,
  );
});

Then('the score is marked {word}', function (this: AppWorld, status: string) {
  assert.equal(this.screen!.getByTestId('pass-status').props.children, status);
});

Then('the score is marked not passed', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('pass-status').props.children, 'not passed');
});
