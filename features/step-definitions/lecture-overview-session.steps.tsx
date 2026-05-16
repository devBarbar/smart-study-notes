import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { fireEvent, render } from '@testing-library/react-native/pure';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  getMostRecentSession,
  selectOverviewSessionAction,
  sortSessionsByRecency,
} from '../../lib/lecture-session-routing';
import { StudyPlanEntry, StudySession } from '../../types';
import { AppWorld } from '../support/world';

const session = (patch: Partial<StudySession> & Pick<StudySession, 'id'>): StudySession => ({
  title: `Session ${patch.id}`,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const entry = (patch: Partial<StudyPlanEntry> & Pick<StudyPlanEntry, 'id'>): StudyPlanEntry => ({
  lectureId: 'lecture-1',
  title: `Topic ${patch.id}`,
  keyConcepts: [],
  orderIndex: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

const LectureOverviewContinueHarness = ({
  orderedPlan,
  existingFullSession,
  existingEntrySessions,
}: {
  orderedPlan: StudyPlanEntry[];
  existingFullSession: StudySession | null;
  existingEntrySessions: Record<string, StudySession>;
}) => {
  const [openedSessionId, setOpenedSessionId] = useState('');
  const action = selectOverviewSessionAction({
    hasStudyPlan: true,
    orderedPlan,
    passedCount: orderedPlan.filter((item) => item.status === 'passed').length,
    existingFullSession,
    existingEntrySessions,
  });

  const continueOverview = () => {
    if (action.session) {
      setOpenedSessionId(action.session.id);
    }
  };

  return (
    <View>
      <Text testID="overview-action">{action.type}</Text>
      <Text testID="opened-session">{openedSessionId}</Text>
      <Pressable accessibilityRole="button" onPress={continueOverview}>
        <Text>Continue Session</Text>
      </Pressable>
    </View>
  );
};

Given(
  'a lecture overview has an older full session and a newer suggested topic session',
  function (this: AppWorld) {
    const suggestedEntry = entry({ id: 'entry-1', status: 'in_progress' });
    const sessions = sortSessionsByRecency([
      session({
        id: 'full-old',
        lectureId: 'lecture-1',
        createdAt: '2026-01-01T09:00:00.000Z',
      }),
      session({
        id: 'topic-old',
        lectureId: 'lecture-1',
        studyPlanEntryId: 'entry-1',
        createdAt: '2026-01-01T10:00:00.000Z',
      }),
      session({
        id: 'topic-latest',
        lectureId: 'lecture-1',
        studyPlanEntryId: 'entry-1',
        createdAt: '2026-01-02T09:00:00.000Z',
      }),
      session({
        id: 'unrelated-a',
        lectureId: 'lecture-1',
        studyPlanEntryId: 'entry-2',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
      session({
        id: 'unrelated-b',
        lectureId: 'lecture-1',
        studyPlanEntryId: 'entry-2',
        createdAt: '2026-01-01T11:00:00.000Z',
      }),
    ]);
    const existingFullSession = getMostRecentSession(
      sessions,
      (candidate) => candidate.lectureId === 'lecture-1' && !candidate.studyPlanEntryId,
    );
    const existingEntrySession = getMostRecentSession(
      sessions,
      (candidate) =>
        candidate.lectureId === 'lecture-1' &&
        candidate.studyPlanEntryId === suggestedEntry.id,
    );

    this.screen = render(
      <LectureOverviewContinueHarness
        orderedPlan={[suggestedEntry]}
        existingFullSession={existingFullSession}
        existingEntrySessions={existingEntrySession ? { 'entry-1': existingEntrySession } : {}}
      />,
    );
  },
);

When('the student continues from the lecture overview', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByText('Continue Session'));
});

Then('the suggested topic session is opened', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('overview-action').props.children, 'continueTopic');
  assert.equal(this.screen!.getByTestId('opened-session').props.children, 'topic-latest');
});
