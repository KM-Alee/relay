'use client';
// The actual player (lazy chunk; import `RelayLottie` from './index', never this file directly).
// Loads /lottie/<name>.json once per session, re-colours every `tok:*` fill/stroke from the live CSS variables
// (so light/dark always match tokens.md) and plays it with the light lottie-web build (svg, no expressions).
// Reduced motion: never autoplays; it seeks to the rest frame (last frame for one-shots, first for loops).
import { LottieLight, type LottieHandle } from 'lottie-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { useMotionOff } from '../motion/primitives';
import { LOTTIE_META, TOKEN_VAR, type LottieName } from './names';

type Json = Record<string, unknown>;
const cache = new Map<LottieName, Promise<Json>>();

function load(name: LottieName): Promise<Json> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/lottie/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`lottie ${name}: ${r.status}`);
      return r.json() as Promise<Json>;
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}

function cssColour(varName: string): [number, number, number] | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const n = Number.parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/
    .exec(raw)?.[1]
    ?.split(/[ ,/]+/)
    .map(Number);
  return rgb && rgb.length >= 3 ? [rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255] : null;
}

function recolour(data: Json): Json {
  const out = structuredClone(data);
  const colours = new Map<string, [number, number, number] | null>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const o = node as Json;
    if ((o.ty === 'fl' || o.ty === 'st') && typeof o.nm === 'string' && o.nm.startsWith('tok:')) {
      const tok = o.nm.slice(4);
      if (!colours.has(tok)) colours.set(tok, TOKEN_VAR[tok] ? cssColour(TOKEN_VAR[tok]) : null);
      const c = colours.get(tok);
      if (c) o.c = { a: 0, k: [...c, 1] };
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(out);
  return out;
}

// Theme = the `data-theme` attribute on <html> (works with or without ThemeProvider, e.g. on /f/*).
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
const readTheme = () => document.documentElement.getAttribute('data-theme') ?? 'light';

export interface LottiePlayerProps {
  name: LottieName;
  /** Overrides the file's default (one-shots play once, ambient ones loop). */
  loop?: boolean;
  className?: string;
  /** Accessible name. Omit for decorative use (default): the animation is aria-hidden. */
  label?: string;
  onComplete?: () => void;
}

export default function LottiePlayer({ name, loop, className, label, onComplete }: LottiePlayerProps) {
  const off = useMotionOff();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light');
  const [raw, setRaw] = useState<Json | null>(null);
  const handle = useRef<LottieHandle>(null);
  const meta = LOTTIE_META[name];
  const shouldLoop = loop ?? meta.loop;

  useEffect(() => {
    let live = true;
    load(name).then(
      (d) => live && setRaw(d),
      () => undefined, // decorative: a failed fetch just leaves the placeholder
    );
    return () => {
      live = false;
    };
  }, [name]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `theme` is the trigger: re-read the CSS variables
  const src = useMemo(() => (raw ? recolour(raw) : null), [raw, theme]);

  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (!src) return <div className={cn('relay-lottie', className)} {...a11y} />;
  return (
    <LottieLight
      key={`${theme}-${off ? 'still' : 'play'}`}
      src={src}
      lottieRef={handle}
      autoplay={!off}
      loop={off ? false : shouldLoop}
      className={cn('relay-lottie', className)}
      {...a11y}
      subscriptions={{
        ready: () => {
          if (off) handle.current?.seek({ percent: meta.rest === 'last' ? 100 : 0 });
        },
        complete: () => onComplete?.(),
      }}
    />
  );
}
