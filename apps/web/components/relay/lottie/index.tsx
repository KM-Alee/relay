'use client';
// Lottie kit (Lane D3, T-228; components.md §7 budget <= 5). Lazy, client-only, decorative by default.
//
//   <RelayLottie name="celebrate" className="size-28" />            one-shot, aria-hidden
//   <RelayLottie name="live" className="size-5" label={t('live')} /> meaningful → role="img" + label
//
// The lottie-web engine (~60 KB gz) loads only when a RelayLottie first renders. Until then (and if JS or the
// fetch fails) a same-size, empty box holds the layout. Reduced motion → a still rest frame, never autoplay.
import dynamic from 'next/dynamic';
import { cn } from '@/components/ui/cn';
import type { LottiePlayerProps } from './lottie-player';

export { LOTTIE_META, LOTTIE_NAMES, type LottieName } from './names';

const Player = dynamic(() => import('./lottie-player'), {
  ssr: false,
  loading: () => <span aria-hidden className="relay-lottie block" />,
});

export function RelayLottie({ className, ...props }: LottiePlayerProps) {
  return (
    <span className={cn('relay-lottie-box inline-block shrink-0 [&>*]:size-full', className)}>
      <Player {...props} className="size-full" />
    </span>
  );
}
