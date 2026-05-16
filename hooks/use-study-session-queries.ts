import { useQuery } from '@tanstack/react-query';

import {
  getSessionById,
  getStudyPlanEntry,
  listAnswerLinks,
  listSessionMessages,
  listStudyDepthChecks,
  listStudyMisconceptions,
} from '@/lib/supabase';
import {
  StudyAnswerLink,
  StudyChatMessage,
  StudyDepthCheck,
  StudyMisconception,
  StudyPlanEntry,
  StudySession,
} from '@/types';

type UseStudySessionQueriesParams = {
  sessionId?: string;
  lectureId?: string;
  studyPlanEntryId?: string;
};

export const studySessionQueryKeys = {
  session: (sessionId?: string) => ['study-session', sessionId] as const,
  messages: (sessionId?: string) => ['study-session', sessionId, 'messages'] as const,
  answerLinks: (sessionId?: string) => ['study-session', sessionId, 'answer-links'] as const,
  studyPlanEntry: (studyPlanEntryId?: string) =>
    ['study-plan-entry', studyPlanEntryId] as const,
  depthChecks: (studyPlanEntryId?: string, sessionId?: string) =>
    ['study-depth-checks', studyPlanEntryId, sessionId] as const,
  misconceptions: (lectureId?: string, studyPlanEntryId?: string) =>
    ['study-misconceptions', lectureId, studyPlanEntryId] as const,
};

export const useStudySessionQueries = ({
  sessionId,
  lectureId,
  studyPlanEntryId,
}: UseStudySessionQueriesParams) => {
  const sessionQuery = useQuery<StudySession | null>({
    queryKey: studySessionQueryKeys.session(sessionId),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) return null;
      try {
        return await getSessionById(sessionId);
      } catch (err) {
        console.warn('[study-query] failed to load session', err);
        return null;
      }
    },
  });

  const messagesQuery = useQuery<StudyChatMessage[]>({
    queryKey: studySessionQueryKeys.messages(sessionId),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) return [];
      try {
        return await listSessionMessages(sessionId);
      } catch (err) {
        console.warn('[study-query] failed to load messages', err);
        return [];
      }
    },
  });

  const answerLinksQuery = useQuery<StudyAnswerLink[]>({
    queryKey: studySessionQueryKeys.answerLinks(sessionId),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      if (!sessionId) return [];
      try {
        return await listAnswerLinks(sessionId);
      } catch (err) {
        console.warn('[study-query] failed to load answer links', err);
        return [];
      }
    },
  });

  const studyPlanEntryQuery = useQuery<StudyPlanEntry | null>({
    queryKey: studySessionQueryKeys.studyPlanEntry(studyPlanEntryId),
    enabled: Boolean(studyPlanEntryId),
    queryFn: async () => {
      if (!studyPlanEntryId) return null;
      try {
        return await getStudyPlanEntry(studyPlanEntryId);
      } catch (err) {
        console.warn('[study-query] failed to load study plan entry', err);
        return null;
      }
    },
  });

  const depthChecksQuery = useQuery<StudyDepthCheck[]>({
    queryKey: studySessionQueryKeys.depthChecks(studyPlanEntryId, sessionId),
    enabled: Boolean(studyPlanEntryId && sessionId),
    queryFn: async () => {
      if (!studyPlanEntryId || !sessionId) return [];
      try {
        return await listStudyDepthChecks(studyPlanEntryId, sessionId);
      } catch (err) {
        console.warn('[study-query] failed to load depth checks', err);
        return [];
      }
    },
  });

  const misconceptionsQuery = useQuery<StudyMisconception[]>({
    queryKey: studySessionQueryKeys.misconceptions(lectureId, studyPlanEntryId),
    enabled: Boolean(lectureId),
    queryFn: async () => {
      if (!lectureId) return [];
      try {
        return await listStudyMisconceptions({
          lectureId,
          studyPlanEntryId: studyPlanEntryId || undefined,
          limit: 8,
        });
      } catch (err) {
        console.warn('[study-query] failed to load misconceptions', err);
        return [];
      }
    },
  });

  return {
    sessionQuery,
    messagesQuery,
    answerLinksQuery,
    studyPlanEntryQuery,
    depthChecksQuery,
    misconceptionsQuery,
  };
};
