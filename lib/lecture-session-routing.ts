import type { StudyPlanEntry, StudySession } from '../types';

export const getSessionTime = (session: StudySession) => {
  const time = Date.parse(session.createdAt);
  return Number.isNaN(time) ? 0 : time;
};

export const compareSessionsByRecency = (a: StudySession, b: StudySession) => {
  const timeDifference = getSessionTime(b) - getSessionTime(a);
  if (timeDifference !== 0) return timeDifference;
  return b.id.localeCompare(a.id);
};

export const pickMoreRecentSession = (
  current: StudySession | null,
  candidate: StudySession,
) => {
  if (!current) return candidate;
  return compareSessionsByRecency(candidate, current) < 0 ? candidate : current;
};

export const getMostRecentSession = (
  sessions: StudySession[],
  matches: (session: StudySession) => boolean,
) => {
  let latest: StudySession | null = null;

  for (const session of sessions) {
    if (matches(session)) {
      latest = pickMoreRecentSession(latest, session);
    }
  }

  return latest;
};

export const sortSessionsByRecency = (sessions: StudySession[]) =>
  [...sessions].sort(compareSessionsByRecency);

type OverviewSessionAction =
  | { type: 'generate' }
  | { type: 'practice' }
  | { type: 'continue'; session: StudySession }
  | { type: 'continueTopic'; entry: StudyPlanEntry; session: StudySession }
  | { type: 'startTopic'; entry: StudyPlanEntry }
  | { type: 'study' };

type SelectOverviewSessionActionParams = {
  hasStudyPlan: boolean;
  orderedPlan: StudyPlanEntry[];
  passedCount: number;
  existingFullSession: StudySession | null;
  existingEntrySessions: Record<string, StudySession>;
};

export const selectOverviewSessionAction = ({
  hasStudyPlan,
  orderedPlan,
  passedCount,
  existingFullSession,
  existingEntrySessions,
}: SelectOverviewSessionActionParams): OverviewSessionAction => {
  if (!hasStudyPlan) {
    return { type: 'generate' };
  }

  const allPassed = passedCount === orderedPlan.length && orderedPlan.length > 0;
  if (allPassed) {
    return { type: 'practice' };
  }

  const suggestedEntry = orderedPlan.find((entry) => entry.status !== 'passed');
  if (suggestedEntry) {
    const session = existingEntrySessions[suggestedEntry.id];
    if (session) {
      return { type: 'continueTopic', entry: suggestedEntry, session };
    }
  }

  if (existingFullSession) {
    return { type: 'continue', session: existingFullSession };
  }

  if (suggestedEntry) {
    return { type: 'startTopic', entry: suggestedEntry };
  }

  return { type: 'study' };
};
