import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { fireEvent, render } from '@testing-library/react-native/pure';
import React from 'react';

import { ExamSprintPanel } from '../components/exam-sprint-panel';
import { ExamSprintPlan, ExamSprintTask } from '../types';

const task = (patch: Partial<ExamSprintTask> = {}): ExamSprintTask => ({
  id: 'study:topic-1',
  type: 'study',
  action: 'start_topic',
  title: 'Study Vector spaces',
  subtitle: 'core · needs repair',
  estimatedMinutes: 35,
  priority: 100,
  studyPlanEntryId: 'topic-1',
  ...patch,
});

const readyPlan = (patch: Partial<ExamSprintPlan> = {}): ExamSprintPlan => ({
  status: 'ready',
  daysUntilExam: 3,
  dailyCapacityMinutes: 90,
  totalAvailableMinutes: 270,
  riskLevel: 'tight',
  readiness: {
    percentage: 52,
    predictedGrade: '3.7',
  },
  generatedAt: '2026-05-17T09:00:00.000Z',
  nextTask: task(),
  days: [
    {
      date: '2026-05-17',
      label: 'Today',
      capacityMinutes: 90,
      totalMinutes: 50,
      tasks: [task(), task({ id: 'review:0', type: 'review', action: 'review_flashcards', title: 'Review flashcards & recall', estimatedMinutes: 15 })],
    },
    {
      date: '2026-05-18',
      label: 'Tomorrow',
      capacityMinutes: 90,
      totalMinutes: 0,
      tasks: [],
    },
  ],
  ...patch,
});

test('exam sprint panel renders ready plan metrics and invokes the next task', () => {
  let selectedTask: ExamSprintTask | undefined;
  const screen = render(
    <ExamSprintPanel plan={readyPlan()} onTaskPress={(pressedTask) => { selectedTask = pressedTask; }} />,
  );

  assert.ok(screen.getByText('Exam Sprint'));
  assert.equal(screen.getByTestId('exam-sprint-next-title').props.children, 'Study Vector spaces');

  fireEvent.press(screen.getByTestId('exam-sprint-next-action'));

  assert.equal(selectedTask?.studyPlanEntryId, 'topic-1');
});

test('exam sprint panel renders setup state and invokes setup action', () => {
  let setupPressed = false;
  const screen = render(
    <ExamSprintPanel
      plan={readyPlan({
        status: 'setup_required',
        daysUntilExam: 0,
        dailyCapacityMinutes: 0,
        totalAvailableMinutes: 0,
        riskLevel: 'critical',
        days: [],
        nextTask: task({
          id: 'setup:exam-date',
          type: 'setup',
          action: 'set_exam_date',
          title: 'Add exam date',
          estimatedMinutes: 5,
        }),
      })}
      onSetupPress={() => { setupPressed = true; }}
    />,
  );

  assert.ok(screen.getByText('Add a future exam date and study-time budget to generate a crash-course plan.'));

  fireEvent.press(screen.getByTestId('exam-sprint-next-action'));

  assert.equal(setupPressed, true);
});
