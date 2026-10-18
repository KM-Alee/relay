'use client';
// Show / hide figures (F5.5). Native checkboxes: keyboard and screen-reader friendly by default.
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { FIGURE_IDS, type FigureId } from './helpers';

export function CustomizeDialog({
  hidden,
  onToggle,
  onReset,
  available,
}: {
  hidden: ReadonlySet<FigureId>;
  onToggle: (f: FigureId) => void;
  onReset: () => void;
  /** Figures this role can see at all (e.g. `risk` is company-only). */
  available: ReadonlySet<FigureId>;
}) {
  const t = useTranslations('overview.customize');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={SlidersHorizontal} />
          {t('button')}
          {hidden.size > 0 ? (
            <span className="sr-only">{t('hiddenCount', { count: hidden.size })}</span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('title')} description={t('description')}>
        <ul className="space-y-1">
          {FIGURE_IDS.filter((id) => available.has(id)).map((id) => (
            <li key={id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-surface-muted">
                <input
                  type="checkbox"
                  className="size-5 accent-brand-strong"
                  checked={!hidden.has(id)}
                  onChange={() => onToggle(id)}
                />
                <span className="text-body text-fg">{t(`figures.${id}`)}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onReset} disabled={hidden.size === 0}>
            {t('reset')}
          </Button>
          <DialogClose asChild>
            <Button variant="primary">{t('done')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
