import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native/pure';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { emptyLectureProgressCounts, LectureProgressCounts } from '../../lib/lecture-progress-reset';
import { AppWorld } from '../support/world';

type ResetHarnessState = {
  materials: string[];
  planEntries: string[];
  progress: LectureProgressCounts;
};

const LectureProgressResetHarness = ({
  resetProgress,
}: {
  resetProgress: () => Promise<LectureProgressCounts>;
}) => {
  const [state, setState] = useState<ResetHarnessState>({
    materials: ['operating-systems.pdf'],
    planEntries: ['Processes', 'Virtual memory'],
    progress: {
      sessions: 2,
      flashcards: 3,
      practiceExams: 1,
      cheatSheets: 1,
    },
  });

  const handleReset = async () => {
    const progress = await resetProgress();
    setState((current) => ({ ...current, progress }));
  };

  return (
    <View>
      <Text testID="materials-count">{state.materials.length}</Text>
      <Text testID="plan-count">{state.planEntries.length}</Text>
      <Text testID="sessions-count">{state.progress.sessions}</Text>
      <Text testID="flashcards-count">{state.progress.flashcards}</Text>
      <Text testID="practice-count">{state.progress.practiceExams}</Text>
      <Text testID="cheat-sheet-count">{state.progress.cheatSheets}</Text>
      <Pressable accessibilityRole="button" onPress={handleReset}>
        <Text>Reset progress</Text>
      </Pressable>
    </View>
  );
};

Given('a lecture has uploaded materials, a study plan, and existing progress', function (this: AppWorld) {
  this.screen = render(
    <LectureProgressResetHarness resetProgress={async () => emptyLectureProgressCounts} />,
  );
});

When('the student resets the lecture progress', async function (this: AppWorld) {
  await act(async () => {
    fireEvent.press(this.screen!.getByText('Reset progress'));
  });
});

Then('the lecture materials and study plan remain', async function (this: AppWorld) {
  await waitFor(() => {
    assert.equal(this.screen!.getByTestId('materials-count').props.children, 1);
    assert.equal(this.screen!.getByTestId('plan-count').props.children, 2);
  });
});

Then('the sessions, flashcards, practice exams, and cheat sheet are cleared', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('sessions-count').props.children, 0);
  assert.equal(this.screen!.getByTestId('flashcards-count').props.children, 0);
  assert.equal(this.screen!.getByTestId('practice-count').props.children, 0);
  assert.equal(this.screen!.getByTestId('cheat-sheet-count').props.children, 0);
});
