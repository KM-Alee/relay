// AIBadge (DS-14, F2.7, F6.3): AI content is always marked with the text "AI" in violet.
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';

export function AIBadge({ className, children }: { className?: string; children?: React.ReactNode }) {
  const t = useTranslations('common');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-chip bg-ai-surface px-2 py-0.5 text-meta font-semibold text-ai',
        className,
      )}
    >
      <Sparkles aria-hidden className="size-3" />
      <span>{t('ai.badge')}</span>
      {children ? <span className="font-normal">{children}</span> : null}
    </span>
  );
}
