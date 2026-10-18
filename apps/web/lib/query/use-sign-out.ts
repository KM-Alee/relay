'use client';
// Sign out (F1.8): POST /api/v1/auth/logout, drop every cached query, go to /login.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { useRouter } from '@/lib/i18n/navigation';

export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  const te = useTranslations();
  const mutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      qc.clear();
      router.replace('/login');
      router.refresh();
    },
    onError: (err) => toast.error(localizeError(err, (k, v) => te(k, v))),
  });
  return { signOut: () => mutation.mutate(), pending: mutation.isPending };
}
