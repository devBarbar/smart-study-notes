import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { deleteFlashcard, getFlashcardCount, getSupabase, listFlashcards, NewFlashcardInput, saveFlashcard, updateFlashcardMastery } from '@/lib/supabase';
import { Flashcard, FlashcardDifficulty } from '@/types';

/**
 * Hook to fetch and manage flashcards for a specific lecture
 */
export const useFlashcards = (lectureId: string | undefined) => {
  const queryClient = useQueryClient();
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (subscribedRef.current || !lectureId) return;

    try {
      const client = getSupabase();
      const channel = client
        .channel(`flashcards-${lectureId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'flashcards', filter: `lecture_id=eq.${lectureId}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['flashcards', lectureId] });
            queryClient.invalidateQueries({ queryKey: ['flashcard-count', lectureId] });
          }
        )
        .subscribe();

      subscribedRef.current = true;

      return () => {
        subscribedRef.current = false;
        channel.unsubscribe();
      };
    } catch (err) {
      console.warn('[useFlashcards] realtime subscription skipped', err);
      return;
    }
  }, [queryClient, lectureId]);

  return useQuery<Flashcard[]>({
    queryKey: ['flashcards', lectureId],
    queryFn: async () => {
      if (!lectureId) return [];
      try {
        return await listFlashcards(lectureId);
      } catch {
        return [];
      }
    },
    enabled: !!lectureId,
  });
};

/**
 * Hook to get flashcard count for a lecture
 */
export const useFlashcardCount = (lectureId: string | undefined) => {
  return useQuery<number>({
    queryKey: ['flashcard-count', lectureId],
    queryFn: async () => {
      if (!lectureId) return 0;
      try {
        return await getFlashcardCount(lectureId);
      } catch {
        return 0;
      }
    },
    enabled: !!lectureId,
  });
};

/**
 * Hook to create a new flashcard
 */
export const useCreateFlashcard = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (flashcard: NewFlashcardInput) => {
      return await saveFlashcard(flashcard);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['flashcards', variables.lectureId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-count', variables.lectureId] });
    },
  });
};

/**
 * Hook to update flashcard mastery after review
 */
export const useUpdateFlashcardMastery = (lectureId: string | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ flashcardId, difficulty }: { flashcardId: string; difficulty: FlashcardDifficulty }) => {
      await updateFlashcardMastery(flashcardId, difficulty);
    },
    onSuccess: () => {
      if (lectureId) {
        queryClient.invalidateQueries({ queryKey: ['flashcards', lectureId] });
      }
    },
  });
};

/**
 * Hook to delete a flashcard
 */
export const useDeleteFlashcard = (lectureId: string | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (flashcardId: string) => {
      await deleteFlashcard(flashcardId);
    },
    onSuccess: () => {
      if (lectureId) {
        queryClient.invalidateQueries({ queryKey: ['flashcards', lectureId] });
        queryClient.invalidateQueries({ queryKey: ['flashcard-count', lectureId] });
      }
    },
  });
};
