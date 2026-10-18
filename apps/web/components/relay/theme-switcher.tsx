'use client';
// Light / dark / system. `segmented` is an inline radio group (sheet, settings, kitchen sink);
// `ThemeRadioItems` is the same choice inside a dropdown menu.
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { useTheme, type ThemeChoice } from './theme';

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; icon: LucideIcon }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function ThemeSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className={cn('inline-flex rounded-control bg-surface-muted p-1', className)}
    >
      {OPTIONS.map(({ value, icon: Glyph }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-button text-fg-2 transition-colors',
            theme === value ? 'bg-surface text-fg shadow-card' : 'hover:text-fg',
          )}
        >
          <Glyph aria-hidden className="size-4" />
          {t(`theme.${value}`)}
        </button>
      ))}
    </div>
  );
}

export function ThemeRadioItems() {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  return (
    <>
      <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
        {OPTIONS.map(({ value, icon: Glyph }) => (
          <DropdownMenuRadioItem key={value} value={value}>
            <Glyph aria-hidden />
            {t(`theme.${value}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
