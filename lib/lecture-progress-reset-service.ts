import { LectureProgressCounts, LECTURE_PROGRESS_RESET_RPC } from '@/lib/lecture-progress-reset';

type ResetProgressClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>
  ) => any;
};

type ResetLectureProgressDeps = {
  client: ResetProgressClient | null;
  requireUser: () => Promise<unknown>;
};

export const resetLectureProgress = async (
  lectureId: string,
  deps: ResetLectureProgressDeps,
): Promise<LectureProgressCounts> => {
  const client = deps.client;
  if (!client) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const user = await deps.requireUser();
  if (!user) {
    throw new Error('User must be authenticated to perform this action');
  }

  const { data, error } = await client.rpc(LECTURE_PROGRESS_RESET_RPC, {
    p_lecture_id: lectureId,
  });

  if (error) throw error;

  return {
    sessions: Number(data?.sessions ?? 0),
    flashcards: Number(data?.flashcards ?? 0),
    practiceExams: Number(data?.practiceExams ?? 0),
    cheatSheets: Number(data?.cheatSheets ?? 0),
  };
};
