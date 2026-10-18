// Server-side gating for pages (Server Components). T-101/T-102, F1.5, docs/07-frontend-i18n.md §1.
//
//   const actor = await requireActor();                 // signed out → redirect to /login
//   const actor = await requirePermission('audit.view'); // + lacking the permission → 404
//   const actor = await requirePage('audit');            // same, using the permission from nav.ts
//
// The (app) layout calls requireActor() for the first load; every permission-gated page calls
// requirePage()/requirePermission() itself (layouts don't re-render on client navigation). APIs
// re-check everything anyway — page gating is about not rendering what the user may not see.
import type { Actor } from '@relay/core/auth/actor';
import { can, type PermissionKey } from '@relay/core/auth/permissions';
import { resolveSession, sessionCookieName } from '@relay/core/auth/sessions';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { redirect } from '@/lib/i18n/navigation';
import { NAV } from '@/nav';
import { secureCookies } from './session';

/** The signed-in Actor for this render, or null. Memoized per request. Never rotates (no cookie writes). */
export const getPageActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(sessionCookieName(secureCookies()))?.value;
  if (!token) return null;
  const h = await headers();
  const resolved = await resolveSession(token, {
    allowRotate: false,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  });
  return resolved?.actor ?? null;
});

async function currentLocale(): Promise<'en' | 'ur'> {
  const { getLocale } = await import('next-intl/server');
  return (await getLocale()) === 'ur' ? 'ur' : 'en';
}

/** The path the user asked for (set by proxy.ts), without the locale prefix; null when unknown/unsafe. */
async function requestedPath(): Promise<string | null> {
  const raw = (await headers()).get('x-relay-path');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  const p = raw.replace(/^\/ur(?=\/|\?|$)/, '') || '/';
  return p === '/' || p.startsWith('/login') || !p.startsWith('/') ? null : p;
}

/** Signed out (or session expired/revoked) → redirect to /login?next=<requested path>. */
export async function requireActor(): Promise<Actor> {
  const actor = await getPageActor();
  if (actor) return actor;
  const next = await requestedPath();
  return redirect({
    href: next ? `/login?next=${encodeURIComponent(next)}` : '/login',
    locale: await currentLocale(),
  });
}

/** Signed in AND holding `key`, else 404 (never reveal what exists, F1.5/F1.6). */
export async function requirePermission(key: PermissionKey): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, key)) notFound();
  return actor;
}

/** Gate by nav.ts entry id: one source of truth for page permissions. */
export async function requirePage(navId: string): Promise<Actor> {
  const item = NAV.find((i) => i.id === navId);
  if (!item) throw new Error(`requirePage: unknown nav id "${navId}"`);
  return item.perm ? requirePermission(item.perm) : requireActor();
}
