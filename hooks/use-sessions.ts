import { useQuery } from '@tanstack/react-query';
import { listSessions } from '@/lib/supabase';
import { StudySession } from '@/types';

export const useSessions = () =>
  useQuery<StudySession[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      try {
        return await listSessions();
      } catch {
        return [];
      }
    },
  });

