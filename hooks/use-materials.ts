import { useQuery } from '@tanstack/react-query';
import { listMaterials } from '@/lib/supabase';
import { Material } from '@/types';

export const useMaterials = () =>
  useQuery<Material[]>({
    queryKey: ['materials'],
    queryFn: async () => {
      try {
        return await listMaterials();
      } catch {
        return [];
      }
    },
  });

