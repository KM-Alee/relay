'use client';
// TopNav (components.md §1, screens.md §1): floating white strip, orange active capsule, NO sidebar.
// Built from `visibleNav()` (nav.ts), so entries the user can't access are not rendered (no fake disabled items).
// Responsive (CSS only, no JS measuring, so SSR never flashes the wrong layout):
//   >= 1280  every primary item + More          960-1279  Automations moves to More
//   600-959  Overview, Leads (+Inbox >= 760) + More          < 600  wordmark + search + bell + labelled Menu sheet
import { ChevronDown, LogIn, Menu, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@/components/ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/dialog';
import type { NavItem } from '@/nav';
import {
  AvailabilityRadioItems,
  AvailabilitySwitcher,
  useAvailabilityRequest,
} from './availability-switcher';
import { Tagline, Wordmark } from './brand';
import { LocaleRadioItems, LocaleSwitcher } from './locale-switcher';
import { Highlight } from './motion/highlight';
import { LayoutGroup } from './motion/presence';
import { navIcon } from './nav-icons';
import { NotificationsPanel, type NotificationItem } from './notifications-panel';
import { SearchCommand } from './search-command';
import { ThemeRadioItems, ThemeSwitcher } from './theme-switcher';
import { TimeWarpBadge } from './time-warp-badge';
import type { Availability } from './owner-chip';

/** Width tier at which a primary item appears in the strip (below it, the item lives in More). */
const SHOW_FROM: Record<string, string> = {
  overview: 'hidden sm:inline-flex',
  leads: 'hidden sm:inline-flex',
  inbox: 'hidden min-[760px]:inline-flex',
  pipeline: 'hidden md:inline-flex',
  recovery: 'hidden md:inline-flex',
  automations: 'hidden min-[1440px]:inline-flex',
};
/** The complement: classes that hide the item in the More menu once it shows in the strip. */
const HIDE_IN_MORE: Record<string, string> = {
  overview: 'sm:hidden',
  leads: 'sm:hidden',
  inbox: 'min-[760px]:hidden',
  pipeline: 'md:hidden',
  recovery: 'md:hidden',
  automations: 'min-[1440px]:hidden',
};

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, className }: { item: NavItem; className?: string }) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative isolate min-h-11 items-center gap-2 whitespace-nowrap rounded-control px-2.5 text-button transition-colors duration-(--dur-fast) lg:px-3',
        active ? 'text-fg' : 'text-fg-2 hover:bg-surface-muted hover:text-fg',
        className,
      )}
    >
      {/* the orange capsule slides between items (shared layout); aria-current carries the state */}
      {active ? <Highlight layoutId="topnav-capsule" className="rounded-control bg-brand-soft" /> : null}
      <Icon icon={navIcon(item.icon)} strokeWidth={1.85} className="size-[18px]" />
      <span>{t(item.labelKey)}</span>
    </Link>
  );
}

export interface TopNavProps {
  /** Output of `visibleNav(perms, …)`. */
  items: readonly NavItem[];
  /** Whether the user is signed in (shows avatar/availability vs a Sign in link). */
  signedIn: boolean;
  roleLabel?: string;
  availability: Availability;
  onAvailabilityChange: (next: Availability) => void;
  notifications?: readonly NotificationItem[];
  /** Time-warp factor; badge renders only when != 1. */
  timeWarp?: number;
  loading?: boolean;
}

export function TopNav({
  items,
  signedIn,
  roleLabel,
  availability,
  onAvailabilityChange,
  notifications,
  timeWarp,
  loading,
}: TopNavProps) {
  const t = useTranslations('common');
  const [menuOpen, setMenuOpen] = useState(false);
  const primary = useMemo(() => items.filter((i) => i.group === 'primary'), [items]);
  const more = useMemo(() => items.filter((i) => i.group === 'more'), [items]);

  return (
    <header className="sticky top-0 z-nav px-(--page-pad) pt-(--nav-margin-top)">
      <div className="mx-auto max-w-(--shell-max)">
        <nav
          aria-label={t('shell.primaryNav')}
          className="flex h-16 items-center gap-1 rounded-card border border-line bg-surface ps-2 pe-2 shadow-card sm:gap-2 sm:ps-3 sm:pe-3 md:h-(--nav-height)"
        >
          <Wordmark className="shrink-0" />

          {/* destinations (>= 600) */}
          <LayoutGroup id="topnav">
            <ul className="ms-2 hidden min-w-0 items-center gap-1 overflow-clip [overflow-clip-margin:8px] sm:flex lg:ms-4">
              {loading ? (
                <li aria-hidden className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="skeleton h-9 w-20 rounded-control" />
                  ))}
                </li>
              ) : (
                primary.map((item) => (
                  <li key={item.id} className="contents">
                    <NavLink
                      item={item}
                      className={SHOW_FROM[item.id] ?? 'hidden min-[1440px]:inline-flex'}
                    />
                  </li>
                ))
              )}
              <li className={cn('hidden sm:block', more.length === 0 && 'min-[1440px]:hidden')}>
                <MoreMenu primary={primary} more={more} />
              </li>
            </ul>
          </LayoutGroup>

          <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {timeWarp && timeWarp !== 1 ? (
              <TimeWarpBadge factor={timeWarp} className="hidden min-[1600px]:inline-flex" />
            ) : null}
            <SearchCommand pages={items} />
            <NotificationsPanel items={notifications} />
            {signedIn ? (
              <>
                <AvailabilitySwitcher
                  value={availability}
                  onChange={onAvailabilityChange}
                  className="hidden min-[1600px]:inline-flex"
                />
                <UserMenu
                  roleLabel={roleLabel}
                  availability={availability}
                  onAvailabilityChange={onAvailabilityChange}
                  className="hidden sm:inline-flex"
                />
              </>
            ) : !loading ? (
              <Button asChild variant="secondary" className="hidden sm:inline-flex">
                <Link href="/login">
                  <Icon icon={LogIn} flipInRtl />
                  {t('actions.signIn')}
                </Link>
              </Button>
            ) : null}

            {/* < 600: labelled Menu button opening a sheet */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="secondary" className="sm:hidden">
                  <Icon icon={Menu} />
                  {t('shell.menu')}
                </Button>
              </SheetTrigger>
              <SheetContent title={t('shell.menu')} side="end">
                <MobileMenu
                  items={items}
                  signedIn={signedIn}
                  availability={availability}
                  onAvailabilityChange={onAvailabilityChange}
                  onNavigate={() => setMenuOpen(false)}
                />
              </SheetContent>
            </Sheet>
          </div>
        </nav>
      </div>
    </header>
  );
}

function MoreMenu({ primary, more }: { primary: readonly NavItem[]; more: readonly NavItem[] }) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const anyActive = more.some((i) => isActive(pathname, i.href));
  const row = (item: NavItem, extra?: string) => (
    <DropdownMenuItem key={item.id} asChild className={extra}>
      <Link href={item.href} aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
        <Icon icon={navIcon(item.icon)} className="text-fg-2" />
        {t(item.labelKey)}
      </Link>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'relative isolate inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-button transition-colors lg:px-3',
          anyActive ? 'text-fg' : 'text-fg-2 hover:bg-surface-muted hover:text-fg',
        )}
      >
        {anyActive ? <Highlight layoutId="topnav-capsule" className="rounded-control bg-brand-soft" /> : null}
        {t('nav.more')}
        <Icon icon={ChevronDown} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/* primary items that don't fit the strip at the current width */}
        {primary.map((i) => row(i, HIDE_IN_MORE[i.id] ?? 'lg:hidden'))}
        <div className={cn(more.length === 0 ? 'hidden' : 'block', 'min-[1440px]:hidden')}>
          <DropdownMenuSeparator />
        </div>
        {more.map((i) => row(i))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({
  roleLabel,
  availability,
  onAvailabilityChange,
  className,
}: {
  roleLabel?: string;
  availability: Availability;
  onAvailabilityChange: (a: Availability) => void;
  className?: string;
}) {
  const t = useTranslations('common');
  const { request, dialog } = useAvailabilityRequest(availability, onAvailabilityChange);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'h-11 shrink-0 items-center gap-2 rounded-control ps-1 pe-2.5 transition-colors hover:bg-surface-muted',
            className,
          )}
        >
          <span className="relative inline-flex size-9 items-center justify-center rounded-chip bg-brand-soft text-fg">
            <User aria-hidden className="size-4" />
          </span>
          <span className="sr-only">{t('shell.userMenu')}</span>
          <span className="hidden text-start min-[1280px]:block">
            <span className="block text-body font-medium leading-tight text-fg">{t('shell.you')}</span>
            {roleLabel ? (
              <span className="block text-meta leading-tight text-fg-muted">{roleLabel}</span>
            ) : null}
          </span>
          <Icon icon={ChevronDown} className="text-fg-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <div className="px-3 py-2">
            <p className="text-body font-medium text-fg">{t('shell.you')}</p>
            {roleLabel ? <p className="text-meta text-fg-muted">{roleLabel}</p> : null}
          </div>
          <DropdownMenuSeparator />
          <AvailabilityRadioItems value={availability} onRequest={request} />
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/me">
              <Icon icon={User} className="text-fg-2" />
              {t('nav.me')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ThemeRadioItems />
          <DropdownMenuSeparator />
          <LocaleRadioItems />
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}

function MobileMenu({
  items,
  signedIn,
  availability,
  onAvailabilityChange,
  onNavigate,
}: {
  items: readonly NavItem[];
  signedIn: boolean;
  availability: Availability;
  onAvailabilityChange: (a: Availability) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const list = items.filter((i) => i.group !== 'hidden' || i.id === 'me');
  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">
        {list.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-control px-3 text-body',
                  active ? 'bg-brand-soft font-medium text-fg' : 'text-fg hover:bg-surface-muted',
                )}
              >
                <Icon icon={navIcon(item.icon)} className="size-5 text-fg-2" />
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
      {signedIn ? (
        <div className="space-y-2">
          <p className="text-meta text-fg-muted">{t('availability.label')}</p>
          <AvailabilitySwitcher
            value={availability}
            onChange={onAvailabilityChange}
            className="w-full justify-between"
          />
        </div>
      ) : (
        <Button asChild variant="primary">
          <Link href="/login" onClick={onNavigate}>
            {t('actions.signIn')}
          </Link>
        </Button>
      )}
      <div className="space-y-2">
        <p className="text-meta text-fg-muted">{t('theme.label')}</p>
        <ThemeSwitcher className="w-full [&>button]:flex-1 [&>button]:justify-center" />
      </div>
      <Tagline className="border-t border-line pt-4" />
      <div className="space-y-2">
        <p className="text-meta text-fg-muted">{t('locale.label')}</p>
        <LocaleSwitcher className="w-full [&>button]:flex-1 [&>button]:justify-center" />
      </div>
    </div>
  );
}
