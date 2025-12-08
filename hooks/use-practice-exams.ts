import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getSupabase, listPracticeExams } from '@/lib/supabase';
import { PracticeExam } from '@/types';

export const usePracticeExams = (lectureId?: string) => {
  const queryClient = useQueryClient();
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!lectureId) return;
    if (subscribedRef.current) return;

    try {
      const client = getSupabase();
      const channel = client
        .channel(`practice-exams-${lectureId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'practice_exams', filter: `lecture_id=eq.${lectureId}` },
          () => queryClient.invalidateQueries({ queryKey: ['practice-exams', lectureId] })
        )
        .subscribe();

      subscribedRef.current = true;

      return () => {
        subscribedRef.current = false;
        channel.unsubscribe();
      };
    } catch (err) {
      console.warn('[usePracticeExams] realtime subscription skipped', err);
      return;
    }
  }, [lectureId, queryClient]);

  return useQuery<PracticeExam[]>({
    queryKey: ['practice-exams', lectureId],
    enabled: Boolean(lectureId),
    queryFn: async () => {
      if (!lectureId) return [];
      try {
        return await listPracticeExams(lectureId);
      } catch {
        return [];
      }
    },
  });
};


