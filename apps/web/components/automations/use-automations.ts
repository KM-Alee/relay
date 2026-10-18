'use client';
// Queries + mutations for the automations screens (Lane A). Mutations go through /api/v1 only, with
// optimistic update + rollback where the UI shows the result immediately, localized error toasts.
import type { PolicyDto } from '@relay/contracts/api/automations';
import type { TeamDto } from '@relay/contracts/api/teams';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';

export const aqk = {
  policies: ['automations', 'policies'] as const,
  teams: ['team', 'list'] as const,
  intake: ['automations', 'intake'] as const,
  people: ['automations', 'people'] as const,
  warp: ['automations', 'time-warp'] as const,
};

export function usePolicies() {
  return useQuery({
    queryKey: aqk.policies,
    queryFn: ({ signal }) => api.automations.listPolicies({ signal }),
  });
}

export function useTeams() {
  return useQuery({ queryKey: aqk.teams, queryFn: ({ signal }) => api.teams.list({ signal }) });
}

export function useIntake() {
  return useQuery({ queryKey: aqk.intake, queryFn: ({ signal }) => api.automations.intake({ signal }) });
}

export interface Person {
  id: string;
  name: string;
}

/** Everyone who can be a member / manager / backup. Falls back to team members if the user list is not permitted. */
export function usePeople(teams: TeamDto[] | undefined) {
  const q = useQuery({
    queryKey: aqk.people,
    queryFn: async ({ signal }): Promise<Person[]> => {
      try {
        const res = await api.users.list({ limit: 100 }, { signal });
        return res.items.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name }));
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });
  const fromTeams = new Map<string, string>();
  for (const t of teams ?? []) for (const m of t.members) fromTeams.set(m.userId, m.name);
  const merged = new Map<string, string>(fromTeams);
  for (const p of q.data ?? []) merged.set(p.id, p.name);
  return [...merged].map(([id, name]) => ({ id, name }));
}

export function useErrorToast() {
  const t = useTranslations();
  return (err: unknown) => toast.error(localizeError(err, t));
}

export function useTimeWarp(enabled = true) {
  return useQuery({
    queryKey: aqk.warp,
    queryFn: ({ signal }) => api.automations.timeWarp({ signal }),
    enabled,
    staleTime: 15_000,
  });
}

export function useSetTimeWarp() {
  const qc = useQueryClient();
  const t = useTranslations('automations.timeWarp');
  const onError = useErrorToast();
  return useMutation({
    mutationFn: (m: 1 | 10 | 60) => api.automations.setTimeWarp(m),
    onMutate: async (m) => {
      await qc.cancelQueries({ queryKey: aqk.warp });
      const previous = qc.getQueryData<{ multiplier: number; demoMode: boolean }>(aqk.warp);
      if (previous) qc.setQueryData(aqk.warp, { ...previous, multiplier: m });
      return { previous };
    },
    onError: (err, _m, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.warp, ctx.previous);
      onError(err);
    },
    onSuccess: (res) => {
      qc.setQueryData(aqk.warp, { multiplier: res.multiplier, demoMode: res.demoMode });
      toast.success(t('applied', { factor: res.multiplier, count: res.rescheduledLeads }));
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['recovery'] });
    },
  });
}

/** Optimistically replace a policy in the cache. */
export function patchPolicyCache(
  qc: ReturnType<typeof useQueryClient>,
  next: PolicyDto,
): { items: PolicyDto[] } | undefined {
  const prev = qc.getQueryData<{ items: PolicyDto[] }>(aqk.policies);
  if (prev) qc.setQueryData(aqk.policies, { items: prev.items.map((p) => (p.id === next.id ? next : p)) });
  return prev;
}
