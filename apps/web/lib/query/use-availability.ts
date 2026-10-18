'use client';
// Own availability (F3.2): optimistic update with rollback + localized toasts (docs/07 §3).
// NOTE: the teams contract (Lane A, T-120) has no availability endpoint yet, so `persist` resolves locally.
// When `api.teams.setAvailability` lands, replace `persist` with that call: nothing else changes.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toaster';
import type { Availability } from '@/components/relay/owner-chip';
import { qk } from './keys';

async function persist(next: Availability): Promise<Availability> {
  return next;
}

export function useAvailability(initial: Availability = 'available') {
  const qc = useQueryClient();
  const t = useTranslations('common');
  const key = qk.team.availability();
  const query = useQuery<Availability>({
    queryKey: key,
    queryFn: () => qc.getQueryData<Availability>(key) ?? initial,
    initialData: initial,
    staleTime: Infinity,
  });
  const mutation = useMutation({
    mutationFn: persist,
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Availability>(key);
      qc.setQueryData(key, next);
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(t('availability.failed'));
    },
    onSuccess: (next) => toast.success(t('availability.saved', { status: t(`availability.${next}`) })),
  });
  return { value: query.data, setValue: mutation.mutate, pending: mutation.isPending };
}
