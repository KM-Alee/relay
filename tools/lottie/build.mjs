#!/usr/bin/env node
// Relay Lottie set (Lane D3, T-228; motion budget <= 5 files, components.md §7).
// Hand-authored vector animations (shapes + keyframes only, no images, no expressions), so licensing is clean
// and each file stays tiny. Run:  node tools/lottie/build.mjs   → apps/web/public/lottie/*.json
//
// Colours: every fill/stroke is named `tok:<token>`. The defaults below are the LIGHT Warm Orange palette;
// at runtime `components/relay/lottie` re-colours each `tok:*` item from the live CSS variable, so the
// animations follow light/dark mode and never drift from docs/design/tokens.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/lottie');
const FR = 60;
const W = 200;
const H = 200;

// Light defaults (0-1 RGB) — mirrors globals.css; overwritten at runtime from the CSS variables.
const PALETTE = {
  brand: [0.953, 0.42, 0.129], // --brand #F36B21
  'brand-soft': [1, 0.878, 0.773], // --brand-soft #FFE0C5
  'brand-faint': [1, 0.953, 0.914], // --brand-faint #FFF3E9
  'data-b': [1, 0.827, 0.678], // --data-series-b #FFD3AD
  ink: [0.067, 0.075, 0.094], // --text-primary #111318
  surface: [1, 1, 1], // --surface
  success: [0.071, 0.42, 0.275], // --success #126B46
  'success-surface': [0.906, 0.969, 0.937], // --success-surface #E7F7EF
};

// ── tiny Lottie DSL ───────────────────────────────────────────────────────────────────────────────
const st = (k) => ({ a: 0, k });
const OUT_EASE = [0.2, 0, 0, 1];
const INOUT = [0.45, 0, 0.55, 1];
const IN = [0.5, 0, 0.9, 0.6];
const LINEAR = [0, 0, 1, 1];
/** frames: [t, value(array|number), ease?, hold?] — ease applies to the segment that STARTS at t. */
const kf = (frames) => ({
  a: 1,
  k: frames.map(([t, v, ease = OUT_EASE, hold = false], i) => {
    const s = Array.isArray(v) ? v : [v];
    if (i === frames.length - 1) return { t, s };
    return {
      t,
      s,
      ...(hold ? { h: 1 } : { o: { x: [ease[0]], y: [ease[1]] }, i: { x: [ease[2]], y: [ease[3]] } }),
    };
  }),
});
const prop = (v) => (v && typeof v === 'object' && 'a' in v ? v : st(v));

const fill = (tok, opacity = 100) => ({
  ty: 'fl',
  nm: `tok:${tok}`,
  c: st([...PALETTE[tok], 1]),
  o: prop(opacity),
  r: 1,
});
const stroke = (tok, w, extra = {}) => ({
  ty: 'st',
  nm: `tok:${tok}`,
  c: st([...PALETTE[tok], 1]),
  o: st(100),
  w: st(w),
  lc: 2,
  lj: 2,
  ml: 4,
  ...extra,
});
const ellipse = (d, p = [0, 0]) => ({ ty: 'el', d: 1, p: st(p), s: prop(Array.isArray(d) ? d : [d, d]) });
const rect = (w, h, r = 0, p = [0, 0]) => ({ ty: 'rc', d: 1, p: st(p), s: st([w, h]), r: st(r) });
const path = (v, i, o, closed = false) => ({ ty: 'sh', d: 1, ks: st({ v, i, o, c: closed }) });
const polyline = (pts) =>
  path(
    pts,
    pts.map(() => [0, 0]),
    pts.map(() => [0, 0]),
  );
const star = (outer, inner, points = 5) => ({
  ty: 'sr',
  sy: 1,
  d: 1,
  pt: st(points),
  p: st([0, 0]),
  r: st(0),
  ir: st(inner),
  is: st(0),
  or: st(outer),
  os: st(0),
});
const trim = (end, start = st(0)) => ({ ty: 'tm', s: start, e: end, o: st(0), m: 1 });
const gtr = ({ p = [0, 0], s = [100, 100], r = 0, o = 100 } = {}) => ({
  ty: 'tr',
  p: prop(p),
  a: st([0, 0]),
  s: prop(s),
  r: prop(r),
  o: prop(o),
  sk: st(0),
  sa: st(0),
});
const group = (nm, items, t) => ({ ty: 'gr', nm, it: [...items, gtr(t)] });

let ind = 0;
/** A shape layer centred at `p` (comp space); shapes are drawn around (0,0). */
const layer = (nm, shapes, { p = [W / 2, H / 2], s = [100, 100], r = 0, o = 100, op } = {}) => {
  const pos =
    p && typeof p === 'object' && 's' in p
      ? p // split position { s: true, x, y }
      : prop(Array.isArray(p) ? [...p, 0] : p);
  const sc = s && typeof s === 'object' && 'a' in s ? s : st([...s, 100]);
  return {
    ddd: 0,
    ind: ++ind,
    ty: 4,
    nm,
    sr: 1,
    ks: { o: prop(o), r: prop(r), p: pos, a: st([0, 0, 0]), s: sc },
    ao: 0,
    shapes,
    ip: 0,
    op,
    st: 0,
    bm: 0,
  };
};
const s3 = (frames) => kf(frames.map(([t, v, e, h]) => [t, [v, v, 100], e, h]));

const comp = (nm, op, layers) => ({
  v: '5.9.0',
  fr: FR,
  ip: 0,
  op,
  w: W,
  h: H,
  nm: `relay-${nm}`,
  ddd: 0,
  assets: [],
  markers: [],
  layers: layers.map((l) => ({ ...l, op })),
});

// Deterministic pseudo-random (confetti) so builds are reproducible.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ── 1. success: halo + disc pop + drawn check + brand sparks (once; rests on the last frame) ──────────
function success() {
  ind = 0;
  const op = 72;
  const check = polyline([
    [-23, 1],
    [-7, 17],
    [25, -15],
  ]);
  const sparks = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2 + Math.PI / 6;
    const from = [W / 2 + Math.cos(a) * 60, H / 2 + Math.sin(a) * 60];
    const to = [W / 2 + Math.cos(a) * 88, H / 2 + Math.sin(a) * 88];
    return layer(`spark-${i}`, [group('dot', [ellipse(9), fill('brand')])], {
      p: kf([
        [20, from],
        [50, to],
      ]),
      s: s3([
        [0, 0],
        [20, 0],
        [28, 110],
        [52, 0],
      ]),
    });
  });
  return comp('success', op, [
    ...sparks,
    layer('check', [
      group('check', [
        check,
        stroke('surface', 11),
        trim(
          kf([
            [18, 0],
            [40, 100],
          ]),
        ),
      ]),
    ]),
    layer('disc', [group('disc', [ellipse(112), fill('success')])], {
      s: s3([
        [0, 0],
        [16, 108],
        [26, 100],
      ]),
    }),
    layer('halo', [group('halo', [ellipse(150), fill('success-surface')])], {
      s: s3([
        [0, 60],
        [24, 112, OUT_EASE],
        [44, 100],
      ]),
      o: kf([
        [0, 0],
        [10, 100],
      ]),
    }),
  ]);
}

// ── 2. all-clear: a calm sun (brand) with slowly turning pale rays + success check badge (loop) ────────
function allClear() {
  ind = 0;
  const op = 240;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 360;
    const rad = (a * Math.PI) / 180;
    return group(`ray-${i}`, [rect(7, 18, 3.5), fill('data-b')], {
      p: [Math.sin(rad) * 68, -Math.cos(rad) * 68],
      r: a,
    });
  });
  const tick = polyline([
    [-7, 0],
    [-2, 5],
    [7, -5],
  ]);
  return comp('all-clear', op, [
    layer(
      'badge',
      [
        group('tick', [tick, stroke('surface', 4.5)]),
        group('dot', [ellipse(32), fill('success')]),
        group('ring', [ellipse(42), fill('surface')]),
      ],
      {
        p: [W / 2 + 36, H / 2 + 34],
        s: s3([
          [0, 100, INOUT],
          [120, 106, INOUT],
          [240, 100],
        ]),
      },
    ),
    layer('sun', [group('sun', [ellipse(88), fill('brand')])], {
      s: s3([
        [0, 100, INOUT],
        [120, 105, INOUT],
        [240, 100],
      ]),
    }),
    layer('rays', rays, {
      r: kf([
        [0, 0, LINEAR],
        [240, 45],
      ]),
    }),
    layer('glow', [group('glow', [ellipse(176), fill('brand-faint')])], {
      s: s3([
        [0, 94, INOUT],
        [120, 104, INOUT],
        [240, 94],
      ]),
    }),
  ]);
}

// ── 3. handoff: a baton arcs between two people, each pulses on arrival (loop; AI → human handoff, loaders)
function handoff() {
  ind = 0;
  const op = 120;
  const person = (nm, x, pulseAt) =>
    layer(
      nm,
      [
        group('head', [ellipse(13, [0, -6]), fill('ink')]),
        group('body', [ellipse([24, 13], [0, 10]), fill('ink')]),
        group('bg', [ellipse(46), fill('brand-soft')]),
      ],
      {
        p: [x, 118],
        s: s3(
          pulseAt === 0
            ? [
                [0, 112, INOUT],
                [14, 100],
                [106, 100, INOUT],
                [120, 112],
              ]
            : [
                [0, 100],
                [48, 100, INOUT],
                [60, 112, INOUT],
                [74, 100],
                [120, 100],
              ],
        ),
      },
    );
  const arc = path(
    [
      [-38, 0],
      [38, 0],
    ],
    [
      [0, 0],
      [0, -52],
    ],
    [
      [0, -52],
      [0, 0],
    ],
  );
  return comp('handoff', op, [
    layer('baton', [group('baton', [ellipse(17), fill('brand')])], {
      p: {
        s: true,
        x: kf([
          [0, 62, INOUT],
          [60, 138, INOUT],
          [120, 62],
        ]),
        y: kf([
          [0, 104, [0.3, 0, 0.6, 1]],
          [30, 64, [0.4, 0, 0.7, 1]],
          [60, 104, [0.3, 0, 0.6, 1]],
          [90, 64, [0.4, 0, 0.7, 1]],
          [120, 104],
        ]),
      },
    }),
    person('to', 150, 60),
    person('from', 50, 0),
    layer(
      'trail',
      [
        group('trail', [
          arc,
          stroke('data-b', 3.5, {
            d: [
              { n: 'd', nm: 'dash', v: st(0.1) },
              { n: 'g', nm: 'gap', v: st(9) },
            ],
          }),
        ]),
      ],
      { p: [100, 104] },
    ),
  ]);
}

// ── 4. celebrate: star badge pops + confetti burst in the brand palette (once; recovery queue empty, paid)
function celebrate() {
  ind = 0;
  seed = 7;
  const op = 100;
  const colours = ['brand', 'data-b', 'ink', 'brand', 'data-b'];
  const confetti = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.3;
    const R = 58 + rnd() * 30;
    const mid = [W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R * 0.9 - 10];
    const end = [mid[0] + (rnd() - 0.5) * 16, mid[1] + 26 + rnd() * 18];
    const tok = colours[i % colours.length];
    const shape = i % 3 === 0 ? ellipse(8) : rect(6, 12, 2);
    const delay = Math.round(rnd() * 6);
    return layer(`c-${i}`, [group('piece', [shape, fill(tok)])], {
      p: kf([
        [4 + delay, [W / 2, H / 2], [0.1, 0.8, 0.3, 1]],
        [32 + delay, mid, IN],
        [92, end],
      ]),
      r: kf([
        [4, 0, LINEAR],
        [92, (rnd() > 0.5 ? 1 : -1) * (180 + rnd() * 240)],
      ]),
      s: s3([
        [0, 0],
        [4 + delay, 0],
        [10 + delay, 100],
      ]),
      o: kf([
        [0, 100],
        [62, 100, IN],
        [94, 0],
      ]),
    });
  });
  return comp('celebrate', op, [
    layer('star', [group('star', [star(29, 13), fill('brand')])], {
      s: s3([
        [0, 0],
        [8, 0],
        [24, 118],
        [34, 100],
      ]),
      r: kf([
        [8, -40],
        [34, 0],
      ]),
    }),
    layer('badge', [group('badge', [ellipse(100), fill('brand-soft')])], {
      s: s3([
        [0, 0],
        [16, 110],
        [26, 100],
      ]),
    }),
    ...confetti,
  ]);
}

// ── 5. live: success dot with two expanding rings (loop; realtime "live", integration connected) ──────
function live() {
  ind = 0;
  const op = 120;
  return comp('live', op, [
    layer('core', [group('core', [ellipse(64), fill('success')])], {
      s: s3([
        [0, 100, INOUT],
        [60, 92, INOUT],
        [120, 100],
      ]),
    }),
    layer('ring-a', [group('ring', [ellipse(64), fill('success')])], {
      s: s3([
        [0, 100, [0.2, 0.6, 0.4, 1]],
        [120, 290],
      ]),
      o: kf([
        [0, 45, [0.2, 0.6, 0.4, 1]],
        [120, 0],
      ]),
    }),
    layer('ring-b', [group('ring', [ellipse(64), fill('success')])], {
      s: s3([
        [0, 195, [0.2, 0.6, 0.4, 1]],
        [60, 290, LINEAR, true],
        [61, 100, [0.2, 0.6, 0.4, 1]],
        [120, 195],
      ]),
      o: kf([
        [0, 22, [0.2, 0.6, 0.4, 1]],
        [60, 0, LINEAR, true],
        [61, 45, [0.2, 0.6, 0.4, 1]],
        [120, 22],
      ]),
    }),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = { success, 'all-clear': allClear, handoff, celebrate, live };
for (const [name, build] of Object.entries(files)) {
  const json = JSON.stringify(build(), (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  writeFileSync(join(OUT, `${name}.json`), json + '\n');
  console.log(`${name}.json  ${(json.length / 1024).toFixed(1)} KB`);
}
