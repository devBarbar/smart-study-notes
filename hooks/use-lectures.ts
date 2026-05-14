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
      if (!client) return;

      const channelSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tables = ['lectures', 'study_plan_entries', 'study_plan_modules'];
      const channels = tables.map((table) =>
        client
          .channel(`lectures-status-${table}-${channelSuffix}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table },
            () => queryClient.invalidateQueries({ queryKey: ['lectures'] })
          )
          .subscribe()
      );

      subscribedRef.current = true;

      return () => {
        subscribedRef.current = false;
        channels.forEach((channel) => channel.unsubscribe());
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
