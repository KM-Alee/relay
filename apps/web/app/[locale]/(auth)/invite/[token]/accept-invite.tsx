'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { EmptyState, FormField, Wordmark } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, localizeError } from '@/lib/api-client';
import { useRouter } from '@/lib/i18n/navigation';
import { useFormat } from '@/lib/format/use-format';

export function AcceptInvite({ token, locale }: { token: string; locale: 'en' | 'ur' }) {
  const t = useTranslations('auth');
  const te = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Preview does not consume the link. Used / expired / revoked / unknown all look the same (410).
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => api.users.previewInvite({ body: { token } }),
    retry: false,
    staleTime: Infinity,
  });
  const accept = useMutation({
    mutationFn: (v: { name: string; email: string; password: string }) =>
      api.users.acceptInvite({ body: { token, locale, ...v } }),
    onSuccess: () => {
      router.replace('/');
      router.refresh();
    },
    onError: (err) => setError(localizeError(err, (k, v) => te(k, v))),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const d = new FormData(e.currentTarget);
    const s = (k: string) => String(d.get(k) ?? '');
    accept.mutate({ name: s('name'), email: s('email'), password: s('password') });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Wordmark />
      {preview.isPending ? (
        <p aria-busy="true" className="text-body text-fg-2">
          {t('invite.loading')}
        </p>
      ) : preview.isError ? (
        <Card>
          <EmptyState
            headingLevel={1}
            title={t('invite.invalidTitle')}
            description={t('invite.invalidBody')}
          />
        </Card>
      ) : (
        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h1 className="text-page text-fg">
              {t('invite.title', { workspace: preview.data.workspaceName })}
            </h1>
            <p className="mt-2 text-body text-fg-2">
              {t('invite.body', {
                level: te(`team.levels.${preview.data.baseLevel}`),
                role: preview.data.roleName ?? '',
              })}
            </p>
            <p className="mt-1 text-meta text-fg-muted">
              {t('invite.expires', { when: f.dateTime(preview.data.expiresAt) })}
            </p>
          </div>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField label={t('fields.name')} required>
              {(p) => <Input {...p} name="name" required maxLength={80} autoComplete="name" />}
            </FormField>
            <FormField label={t('fields.email')} required>
              {(p) => <Input {...p} name="email" type="email" required autoComplete="email" dir="ltr" />}
            </FormField>
            <FormField label={t('fields.password')} helper={t('fields.passwordHint')} required>
              {(p) => (
                <Input
                  {...p}
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  dir="ltr"
                />
              )}
            </FormField>
            {error ? (
              <p role="alert" className="text-body text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" loading={accept.isPending}>
              {t('invite.submit')}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
