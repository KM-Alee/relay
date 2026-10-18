'use client';
// SearchCommand shell (components.md §1): quiet input-like button; Ctrl/⌘K opens a command dialog.
// Results are grouped by type; today only "Pages" (permission-filtered nav). Leads/Contacts/Companies/
// Opportunities/Messages groups plug in with their domains (F9.4 NL command bar extends this dialog).
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Icon } from '@/components/ui/icon';
import { useRouter } from '@/lib/i18n/navigation';
import type { NavItem } from '@/nav';
import { navIcon } from './nav-icons';

const SHORTCUT_HINT = '⌘K';

export function SearchCommand({ pages, className }: { pages: readonly NavItem[]; className?: string }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className={cn(
          'inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-control text-body min-[1280px]:justify-start text-fg-muted transition-colors hover:bg-surface-muted',
          'bg-surface-muted/60 px-3 min-[1280px]:w-44 min-[1440px]:w-52',
          className,
        )}
      >
        <Icon icon={Search} className="size-4 text-fg-2" />
        <span className="hidden min-w-0 flex-1 truncate text-start min-[1280px]:inline">
          {t('shell.searchPlaceholder')}
        </span>
        <span className="sr-only min-[1280px]:hidden">{t('shell.searchTitle')}</span>
        <kbd
          dir="ltr"
          className="hidden rounded-control bg-surface px-1.5 py-0.5 text-[11px] font-medium text-fg-2 min-[1440px]:inline"
        >
          {SHORTCUT_HINT}
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} label={t('shell.searchTitle')}>
        <CommandInput placeholder={t('shell.searchPlaceholder')} />
        <CommandList>
          <CommandEmpty>{t('shell.searchEmpty')}</CommandEmpty>
          <CommandGroup heading={t('shell.searchPages')}>
            {pages.map((p) => (
              <CommandItem
                key={p.id}
                value={t(p.labelKey)}
                onSelect={() => {
                  setOpen(false);
                  router.push(p.href);
                }}
              >
                <Icon icon={navIcon(p.icon)} className="text-fg-2" />
                {t(p.labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
