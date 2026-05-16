import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSessionTime,
  getMostRecentSession,
  selectOverviewSessionAction,
  sortSessionsByRecency,
} from '../lib/lecture-session-routing';
import { StudyPlanEntry, StudySession } from '../types';

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

test('overview continue action prefers the suggested topic session over an older full session', () => {
  const suggestedEntry = entry({ id: 'entry-1', status: 'in_progress' });
  const oldFullSession = session({
    id: 'full-old',
    lectureId: 'lecture-1',
    createdAt: '2026-01-01T09:00:00.000Z',
  });
  const latestTopicSession = session({
    id: 'topic-latest',
    lectureId: 'lecture-1',
    studyPlanEntryId: 'entry-1',
    createdAt: '2026-01-02T09:00:00.000Z',
  });

  const action = selectOverviewSessionAction({
    hasStudyPlan: true,
    orderedPlan: [suggestedEntry],
    passedCount: 0,
    existingFullSession: oldFullSession,
    existingEntrySessions: {
      'entry-1': latestTopicSession,
    },
  });

  assert.equal(action.type, 'continueTopic');
  assert.equal(action.session?.id, 'topic-latest');
  assert.equal(action.entry?.id, 'entry-1');
});

test('overview continue action falls back to the full session when the suggested topic has no session', () => {
  const suggestedEntry = entry({ id: 'entry-1', status: 'not_started' });
  const fullSession = session({
    id: 'full-latest',
    lectureId: 'lecture-1',
    createdAt: '2026-01-02T09:00:00.000Z',
  });

  const action = selectOverviewSessionAction({
    hasStudyPlan: true,
    orderedPlan: [suggestedEntry],
    passedCount: 0,
    existingFullSession: fullSession,
    existingEntrySessions: {},
  });

  assert.equal(action.type, 'continue');
  assert.equal(action.session?.id, 'full-latest');
});

test('session recency helpers pick the newest matching session with a deterministic tie break', () => {
  const older = session({
    id: 'older',
    lectureId: 'lecture-1',
    studyPlanEntryId: 'entry-1',
    createdAt: '2026-01-01T09:00:00.000Z',
  });
  const tiedLowerId = session({
    id: 'topic-a',
    lectureId: 'lecture-1',
    studyPlanEntryId: 'entry-1',
    createdAt: '2026-01-02T09:00:00.000Z',
  });
  const tiedHigherId = session({
    id: 'topic-b',
    lectureId: 'lecture-1',
    studyPlanEntryId: 'entry-1',
    createdAt: '2026-01-02T09:00:00.000Z',
  });

  assert.deepEqual(
    sortSessionsByRecency([older, tiedLowerId, tiedHigherId]).map(({ id }) => id),
    ['topic-b', 'topic-a', 'older'],
  );
  assert.equal(
    getMostRecentSession(
      [older, tiedLowerId, tiedHigherId],
      (candidate) => candidate.studyPlanEntryId === 'entry-1',
    )?.id,
    'topic-b',
  );
  assert.equal(
    getMostRecentSession(
      [older, tiedLowerId, tiedHigherId],
      (candidate) => candidate.studyPlanEntryId === 'missing',
    ),
    null,
  );
  assert.equal(getMostRecentSession([], () => true), null);
  assert.equal(getSessionTime(session({ id: 'invalid-date', createdAt: 'not-a-date' })), 0);
});

test('overview action covers generate, practice, start topic, and study fallbacks', () => {
  assert.equal(
    selectOverviewSessionAction({
      hasStudyPlan: false,
      orderedPlan: [],
      passedCount: 0,
      existingFullSession: null,
      existingEntrySessions: {},
    }).type,
    'generate',
  );

  assert.equal(
    selectOverviewSessionAction({
      hasStudyPlan: true,
      orderedPlan: [entry({ id: 'passed-entry', status: 'passed' })],
      passedCount: 1,
      existingFullSession: null,
      existingEntrySessions: {},
    }).type,
    'practice',
  );

  const startAction = selectOverviewSessionAction({
    hasStudyPlan: true,
    orderedPlan: [entry({ id: 'new-entry', status: 'not_started' })],
    passedCount: 0,
    existingFullSession: null,
    existingEntrySessions: {},
  });
  assert.equal(startAction.type, 'startTopic');
  assert.equal(startAction.entry?.id, 'new-entry');

  assert.equal(
    selectOverviewSessionAction({
      hasStudyPlan: true,
      orderedPlan: [],
      passedCount: 0,
      existingFullSession: null,
      existingEntrySessions: {},
    }).type,
    'study',
  );
});
