import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { fireEvent, render } from '@testing-library/react-native/pure';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { ExamSprintPanel } from '../../components/exam-sprint-panel';
import { buildExamSprintPlan } from '../../lib/exam-sprint-orchestrator';
import { PlanSettings, StudyPlanEntry, StudyReadiness } from '../../types';
import { AppWorld } from '../support/world';

const entry = (patch: Partial<StudyPlanEntry> & Pick<StudyPlanEntry, 'id' | 'title'>): StudyPlanEntry => ({
  lectureId: 'lecture-1',
  keyConcepts: [],
  orderIndex: 0,
  createdAt: '2026-05-01T00:00:00.000Z',
  ...patch,
});

const SprintPanelHarness = ({
  planSettings,
  planEntries,
}: {
  planSettings: PlanSettings;
  planEntries: StudyPlanEntry[];
}) => {
  const [openedTopicId, setOpenedTopicId] = useState('');
  const readiness: StudyReadiness = {
    percentage: 50,
    predictedGrade: '3.7',
    updatedAt: '2026-05-17T09:00:00.000Z',
  };
  const plan = buildExamSprintPlan({
    now: '2026-05-17T09:00:00.000Z',
    planSettings,
    planEntries,
    readiness,
    flashcardCount: 4,
  });

  return (
    <View>
      <ExamSprintPanel
        plan={plan}
        onTaskPress={(task) => setOpenedTopicId(task.studyPlanEntryId ?? '')}
      />
      <Text testID="opened-topic">{openedTopicId}</Text>
    </View>
  );
};

Given('a lecture has an exam in three days with mixed topic progress', function (this: AppWorld) {
  this.values.planSettings = {
    examDate: '2026-05-20',
    targetGrade: 'pass',
    preferredSessionMinutes: 45,
    weeklyStudyMinutes: 630,
    weakAreas: ['vectors'],
  } satisfies PlanSettings;
  this.values.planEntries = [
    entry({
      id: 'stretch',
      title: 'Optional proof extension',
      importanceTier: 'stretch',
      priorityScore: 100,
      status: 'not_started',
      estimatedMinutes: 60,
      orderIndex: 0,
    }),
    entry({
      id: 'vectors',
      title: 'Vector spaces',
      category: 'Linear Algebra',
      importanceTier: 'high-yield',
      priorityScore: 70,
      status: 'failed',
      fromExamSource: true,
      estimatedMinutes: 45,
      orderIndex: 1,
    }),
    entry({
      id: 'matrices',
      title: 'Matrix multiplication',
      category: 'Linear Algebra',
      importanceTier: 'core',
      status: 'passed',
      estimatedMinutes: 45,
      orderIndex: 2,
    }),
  ] satisfies StudyPlanEntry[];
});

When('the student opens the exam sprint panel', function (this: AppWorld) {
  this.screen = render(
    <SprintPanelHarness
      planSettings={this.values.planSettings as PlanSettings}
      planEntries={this.values.planEntries as StudyPlanEntry[]}
    />,
  );
});

Then("today's next sprint action targets the high-yield weak topic", function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('exam-sprint-next-title').props.children, 'Study Vector spaces');
});

When('the student starts the sprint next action', function (this: AppWorld) {
  fireEvent.press(this.screen!.getByTestId('exam-sprint-next-action'));
});

Then('the app opens that topic from the sprint panel', function (this: AppWorld) {
  assert.equal(this.screen!.getByTestId('opened-topic').props.children, 'vectors');
});
