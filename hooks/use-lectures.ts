import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getSupabase, listLectures } from '@/lib/supabase';
import { Lecture } from '@/types';

export const useLectures = () => {
  const queryClient = useQueryClient();
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (subscribedRef.current) return;

    try {
      const client = getSupabase();
      const channel = client
        .channel('lectures-status')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lectures' },
          () => queryClient.invalidateQueries({ queryKey: ['lectures'] })
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'study_plan_entries' },
          () => queryClient.invalidateQueries({ queryKey: ['lectures'] })
        )
        .subscribe();

      subscribedRef.current = true;

      return () => {
        subscribedRef.current = false;
        channel.unsubscribe();
      };
    } catch (err) {
      console.warn('[useLectures] realtime subscription skipped', err);
      return;
    }
  }, [queryClient]);

  return useQuery<Lecture[]>({
    queryKey: ['lectures'],
    queryFn: async () => {
      try {
        return await listLectures();
      } catch {
        return [];
      }
    },
  });
};

