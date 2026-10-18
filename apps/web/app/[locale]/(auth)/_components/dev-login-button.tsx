'use client';
// One-click "sign in as" for /dev/login-as (13 §5, T-010). POST /api/dev/login-as with CSRF via api-client.
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { useRouter } from '@/lib/i18n/navigation';

export function DevLoginButton({ userId, label }: { userId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded border px-3 py-1"
      onClick={async () => {
        setBusy(true);
        try {
          await api.auth.devLoginAs(userId);
          router.replace('/');
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
