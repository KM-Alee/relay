'use client';
// Own availability (F3.2): optimistic update with rollback + localized toasts (docs/07 §3).
// Persisted through PATCH /api/v1/users/:id/availability (T-120); On leave / Offline reassigns pending leads (F3.6).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toaster';
import type { Availability } from '@/components/relay/owner-chip';
import { api } from '@/lib/api-client';
import { qk } from './keys';

const TO_SERVER = { available: 'available', busy: 'busy', onLeave: 'on_leave', offline: 'offline' } as const;

async function persist(next: Availability): Promise<Availability> {
  const me = await api.users.me();
  await api.teams.setAvailability(me.user.id, TO_SERVER[next]);
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
