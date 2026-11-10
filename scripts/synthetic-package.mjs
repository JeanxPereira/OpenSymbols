#!/usr/bin/env node
// A synthetic generated package for developing the demo without a catalog: N geometric symbols
// (rings, discs, bars, squares) drawn from a seed, written by the same writer `generate` uses.
// Purely generated: no catalog, no Apple data. Every symbol says "stand-in" palette and
// unvalidated build, as a package from a non-reference catalog would.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `usage: node scripts/synthetic-package.mjs --out DIR --count N [--seed S]

Writes a generated icon package (index.json, symbols/, index.js, package.json) of N
synthetic symbols into DIR, which must be new, empty or a previous generation.
  --out DIR    where to write; name it synthetic*/ to keep it out of git
  --count N    how many symbols (default 200)
  --seed S     integer; the same seed gives the same package (default 1)

Needs the built packages: run \`pnpm build\` first (this imports packages/cli/dist).
`;

const root = resolve(import.meta.dirname, '..');
const CANVAS = 2000; // path space; real glyphs are about 2048 units wide
const MASTERS = [
  [1, 0.35],
  [4, 1],
  [9, 2.2],
]; // [GlyphWeight master, stroke multiplier]

function usageError(message) {
  process.stderr.write(`synthetic-package: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { out: undefined, count: 200, seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usageError(`${a} needs a value`);
      return v;
    };
    const integer = (v) => {
      if (!/^\d+$/.test(v)) usageError(`${a} must be a non-negative integer, got "${v}"`);
      return Number(v);
    };
    if (a === '--out') opts.out = resolve(next());
    else if (a === '--count') opts.count = integer(next());
    else if (a === '--seed') opts.seed = integer(next());
    else usageError(`unknown argument "${a}"`);
  }
  if (opts.out === undefined) usageError('--out is required');
  if (opts.count < 1) usageError('--count must be at least 1');
  return opts;
}

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round3 = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
};
const round6 = (n) => Number(n.toPrecision(6));

// Path commands as [op, ...args], absolute, y down.
function circle(cx, cy, r, ccw = false) {
  const k = 0.5523 * r;
  return ccw
    ? [
        ['M', cx + r, cy],
        ['C', cx + r, cy - k, cx + k, cy - r, cx, cy - r],
        ['C', cx - k, cy - r, cx - r, cy - k, cx - r, cy],
        ['C', cx - r, cy + k, cx - k, cy + r, cx, cy + r],
        ['C', cx + k, cy + r, cx + r, cy + k, cx + r, cy],
        ['Z'],
      ]
    : [
        ['M', cx + r, cy],
        ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
        ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
        ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
        ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
        ['Z'],
      ];
}

function rect(x, y, w, h, ccw = false) {
  const pts = ccw
    ? [
        [x, y],
        [x, y + h],
        [x + w, y + h],
        [x + w, y],
      ]
    : [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];
  return [['M', ...pts[0]], ['L', ...pts[1]], ['L', ...pts[2]], ['L', ...pts[3]], ['Z']];
}

/**
 * The layers of a symbol at one weight, as lists of commands. The command sequence depends on the
 * spec alone, never on the weight, so every master is point-compatible with the others; the
 * weight moves only the stroke thickness (and the radius or bar width that goes with it).
 * `layers[i].knockout` marks a layer that erases what is behind it.
 */
function geometry(spec, mult, mirror) {
  const t = 110 * mult; // stroke thickness
  const layers = [];
  const C = CANVAS / 2;
  if (spec.kind === 'ring') {
    const R = 800 + 30 * (mult - 1);
    layers.push({ cmds: [...circle(C, C, R), ...circle(C, C, R - t, true)] });
    if (spec.extra) layers.push({ cmds: circle(C, C, 260 + 40 * (mult - 1)) });
  } else if (spec.kind === 'disc') {
    layers.push({ cmds: circle(C, C, 740 + 60 * (mult - 1)) });
    if (spec.extra) layers.push({ cmds: circle(C + 380, C - 380, 230 + 30 * (mult - 1)) });
  } else if (spec.kind === 'square') {
    const half = 740 + 30 * (mult - 1);
    layers.push({ cmds: [...rect(C - half, C - half, 2 * half, 2 * half), ...rect(C - half + t, C - half + t, 2 * (half - t), 2 * (half - t), true)] });
    if (spec.extra) layers.push({ cmds: rect(C - 220, C - 220, 440, 440) });
  } else {
    const n = spec.bars;
    const bw = 170 + 100 * (mult - 1) * 0.8;
    const gap = 110;
    const total = n * bw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const h = 500 + ((1100 - 500) * (i + 1)) / n;
      layers.push({ cmds: rect(C - total / 2 + i * (bw + gap), 1750 - h, bw, h) });
    }
  }
  if (spec.knockout) {
    // A slash across what is drawn so far.
    const w = 90 + 25 * (mult - 1);
    layers.push({ cmds: rect(200, C - w, 1600, 2 * w), knockout: true });
  }
  if (mirror) for (const l of layers) for (const c of l.cmds) for (let i = 1; i < c.length; i += 2) c[i] = CANVAS - c[i];
  return layers;
}

// Generic colours of the synthetic set; "light" and "dark" are made up.
const COLOURS = [
  { name: 'synth-blue', light: '#2a6df4', dark: '#6ea0ff' },
  { name: 'synth-green', light: '#2fa84f', dark: '#5fd37c' },
  { name: 'synth-orange', light: '#e8821a', dark: '#ffa94d' },
  { name: 'synth-pink', light: '#d63a7c', dark: '#ff7ab0' },
  { name: 'synth-teal', light: '#1f9aa8', dark: '#55cfdb' },
];
const ROLES = ['primary', 'secondary', 'tertiary'];
const MONO_OPACITY = [1, 0.6, 0.4, 0.3];

function layerStyles(i, knockout, colour) {
  const role = ROLES[Math.min(i, 2)];
  const style = (paint, opacity = 1) => ({ paint, opacity, clearBehind: knockout });
  if (knockout) {
    const k = style({ kind: 'tint' });
    return { role, modes: { monochrome: k, hierarchical: k, multicolor: k, palette: k } };
  }
  const named = { kind: 'named', name: colour.name, light: colour.light, dark: colour.dark };
  return {
    role,
    modes: {
      monochrome: style({ kind: 'tint' }, MONO_OPACITY[i]),
      hierarchical: style({ kind: 'role', role }),
      multicolor: style(i === 0 ? named : { kind: 'tint' }),
      palette: style({ kind: 'role', role }),
    },
  };
}

/** The shared formula (Docs/format/06 section 9.3), loaded from the built core in `main`. */
let metricCenter;

/**
 * Stroke keyframes (Docs/format/06 section 6.1, 08 section 1) so Draw has something to animate:
 * {flags, progress, d0, d1}, d = subpath + fraction. A bar (one rectangle, perimeter P, short side w)
 * follows the 08 section 12.1 shape: whole outline at progress 0, the centreline ends at progress 1.
 * A ring (two subpaths) cuts both loops: nothing at progress 0, the two half-way points at 1.
 */
function strokeKeyframes(spec, layer, i) {
  if (layer.knockout) return undefined;
  if (spec.kind === 'bars') {
    const xs = layer.cmds.filter((c) => c[0] === 'M' || c[0] === 'L').map((c) => c.slice(1));
    const w = Math.max(...xs.map((p) => p[0])) - Math.min(...xs.map((p) => p[0]));
    const h = Math.max(...xs.map((p) => p[1])) - Math.min(...xs.map((p) => p[1]));
    const P = 2 * (w + h);
    return [
      { flags: 0, progress: 0, d0: 0, d1: round6((P - w) / P) },
      { flags: 0, progress: 1, d0: round6(w / P), d1: round6((w + h) / P) },
    ];
  }
  if (spec.kind === 'ring' && i === 0) {
    return [
      { flags: 0, progress: 0, d0: 0, d1: 1 },
      { flags: 0, progress: 1, d0: 0.5, d1: 1.5 },
    ];
  }
  return undefined;
}

const METRICS = { referencePointSize: 13.9, baselineOffset: 2.5, capHeight: 9.7, leftInset: 0.6, rightInset: 0.6 };

/** One variant: appearance 0 or 1 (dark: a little heavier), direction 0, 4 or 5 (5 is mirrored). */
function variant(spec, dark, direction) {
  const mirror = direction === 5;
  const boost = dark ? 1.12 : 1;
  const perMaster = MASTERS.map(([m, mult]) => [m, geometry(spec, mult * boost, mirror)]);
  const reference = perMaster[1][1]; // master 4
  let ops = '';
  const argCounts = [];
  const layers = reference.map((l, i) => {
    const start = argCounts.length;
    for (const [op, ...args] of l.cmds) {
      ops += op;
      argCounts.push(args.length);
    }
    const colour = COLOURS[(spec.colour + i) % COLOURS.length];
    const data = {
      cmd: [start, argCounts.length],
      ...layerStyles(i, l.knockout === true, colour),
      motionGroup: 1 + (i % spec.motionGroups), // 1..4: the groups an effect staggers by
    };
    const keyframes = strokeKeyframes(spec, reference[i], i);
    if (keyframes !== undefined) data.anim = { strokeKeyframes: keyframes };
    if (spec.thresholds !== undefined && !l.knockout) data.variableThreshold = spec.thresholds[i];
    return data;
  });
  const masters = {};
  for (const [m, ls] of perMaster) {
    const viewBox = [0, 0, 14, 14];
    masters[m] = {
      args: ls.flatMap((l) => l.cmds.flatMap(([, ...args]) => args.map(round3))),
      viewBox,
      transform: spec.transform,
      metrics: METRICS,
      metricCenter: metricCenter(viewBox, spec.transform, METRICS).map(round3),
    };
    // A pivot that moves a little with the weight, like a real master's marker.
    if (spec.anchor !== undefined) {
      masters[m].rotationAnchor = [round3(CANVAS / 2 + spec.anchor[0] + 6 * (MASTERS.find(([k]) => k === m)[1] - 1)), round3(CANVAS / 2 + spec.anchor[1])];
    }
  }
  return {
    ops,
    argCounts,
    masters,
    layers,
    variableValueMode: 'color',
    vcContinuous: false,
    anim: { drawReversesMotionGroups: spec.drawReverses },
  };
}

const CATEGORIES = [
  { key: 'shapes', label: 'Shapes', icon: 'disc', terms: ['shape', 'geometry', 'basic'] },
  { key: 'bars', label: 'Bars', icon: 'bars.3', terms: ['bar', 'level', 'signal'] },
  { key: 'rings', label: 'Rings', icon: 'ring', terms: ['ring', 'loop', 'hollow'] },
  { key: 'filled', label: 'Filled', icon: 'disc.fill', terms: ['solid', 'filled', 'dot'] },
  { key: 'outlined', label: 'Outlined', icon: 'square', terms: ['outline', 'stroke', 'frame'] },
  { key: 'indicators', label: 'Indicators', icon: 'ring.dot', terms: ['indicator', 'status light', 'badge'] },
  { key: 'charts', label: 'Charts', icon: 'bars.4', terms: ['chart', 'graph', 'metric'] },
  { key: 'status', label: 'Status', icon: 'disc.badge', terms: ['status', 'state', 'health'] },
  { key: 'controls', label: 'Controls', icon: 'square.dot', terms: ['control', 'toggle', 'button'] },
  { key: 'media', label: 'Media', icon: 'disc.slash', terms: ['media', 'record', 'player'] },
  { key: 'layout', label: 'Layout', icon: 'square.inset', terms: ['layout', 'grid', 'tile'] },
  { key: 'misc', label: 'Miscellaneous', icon: 'ring.double', terms: ['misc', 'other', 'sample'] },
];
const KIND_CATEGORY = { ring: 'rings', disc: 'filled', bars: 'bars', square: 'outlined' };
const KIND_BASES = { ring: ['ring'], disc: ['disc', 'dot'], square: ['square', 'tile'], bars: ['bars'] };
const MODIFIERS_1 = ['fill', 'badge', 'slash', 'dotted', 'thick', 'outline', 'inset', 'double'];
const MODIFIERS_2 = ['up', 'down', 'left', 'right', 'trailing', 'leading', 'center'];
const LOCALIZED_EVERY = 25;
const YEARS = ['2019', '2020', '2021', '2022', '2023', '2024'];

function makeSymbols(count, seed, componentName) {
  const rand = rng(seed);
  // A second stream for the effect fields, so adding them did not move any name or shape.
  const rand2 = rng((seed ^ 0x9e3779b9) >>> 0);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const used = new Set();
  const symbols = [];
  for (let i = 0; i < count; i++) {
    const kind = pick(['ring', 'disc', 'bars', 'bars', 'square']);
    const hasThresholds = kind === 'bars' && rand() < 0.1 / 0.4; // 10% of all symbols (bars are 40%)
    const spec = {
      kind,
      extra: kind !== 'bars' && rand() < 0.5,
      knockout: rand() < 0.15,
      bars: hasThresholds ? 3 : 2 + Math.floor(rand() * 3),
      colour: Math.floor(rand() * COLOURS.length),
      transform: undefined,
      motionGroups: 1 + Math.floor(rand2() * 4),
      drawReverses: rand2() < 0.5,
      anchor: undefined,
    };
    const anchored = rand2() < 0.3;
    const anchorAt = [round3((rand2() - 0.5) * 600), round3((rand2() - 0.5) * 600)];
    if (anchored) spec.anchor = anchorAt;
    if (spec.kind === 'bars' && spec.knockout && spec.bars === 4) spec.bars = 3; // at most 4 layers
    if (hasThresholds) spec.thresholds = [0.34, 0.67, 1];
    const scale = round6(0.0062 + rand() * 0.001);
    const offset = round6((14 - CANVAS * scale) / 2);
    spec.transform = [scale, 0, 0, scale, offset, offset];
    const dark = rand() < 0.05;
    const pair = rand() < 0.05;

    // A name, unique over lower-cased component names.
    const bases = kind === 'bars' ? [`bars.${spec.bars}`] : KIND_BASES[kind];
    let name;
    for (let attempt = 0; ; attempt++) {
      const parts = [pick(bases)];
      if (rand() < 0.6) parts.push(pick(MODIFIERS_1));
      if (rand() < 0.4) parts.push(pick(MODIFIERS_2));
      if (attempt >= 4) parts.push(String(i + 1));
      name = parts.join('.');
      if (!used.has(componentName(name).toLowerCase())) break;
    }
    used.add(componentName(name).toLowerCase());

    const directions = pair ? [4, 5] : [0];
    const variants = {};
    for (const a of dark ? [0, 1] : [0]) for (const d of directions) variants[`a${a}d${d}`] = variant(spec, a === 1, d);
    const defaultVariant = `a0d${directions[0]}`;

    const own = CATEGORIES.find((c) => c.key === KIND_CATEGORY[kind]);
    const keys = new Set([own.key, CATEGORIES[i % CATEGORIES.length].key]);
    if (rand() < 0.3) keys.add(pick(CATEGORIES).key);
    const categories = [...keys];
    const terms = new Set(['synthetic', ...name.split('.').filter((p) => !/^\d+$/.test(p))]);
    for (const k of categories) for (const t of CATEGORIES.find((c) => c.key === k).terms) if (rand() < 0.6) terms.add(t);
    terms.add(CATEGORIES.find((c) => c.key === own.key).terms[0]);

    const data = {
      v: 1,
      name,
      palette: 'stand-in',
      variants,
      defaultVariant,
      modes: ['monochrome', 'hierarchical', 'multicolor', 'palette'],
      build: { validated: false },
    };
    // Every 25th symbol has localized drawings (Docs/format/05 section 4.3), made up like the rest:
    // "ar" mirrored, "hi" heavier. Drawn from the spec alone, so no name or shape moves.
    if (i % LOCALIZED_EVERY === 0) data.locales = { ar: { a0d0: variant(spec, false, 5) }, hi: { a0d0: variant(spec, true, 0) } };
    symbols.push({
      data,
      categories,
      searchTerms: [...terms],
      year: pick(YEARS),
    });
  }
  return symbols;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let assemble;
  const url = pathToFileURL(join(root, 'packages', 'cli', 'dist', 'generate', 'assemble.js')).href;
  try {
    assemble = await import(url);
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    process.stderr.write(`synthetic-package: cannot load packages/cli/dist (${e.message.split('\n')[0]}); run \`pnpm build\` first\n`);
    process.exit(1);
  }
  const { assemblePackage, symbolFacts, componentName, toWire } = assemble;
  ({ metricCenter } = await import(pathToFileURL(join(root, 'packages', 'core', 'dist', 'index.js')).href));
  const symbols = makeSymbols(opts.count, opts.seed, componentName);
  assemblePackage({
    out: opts.out,
    packageName: 'opensymbols-synthetic',
    // Plausible numbers, so the demo sees the shapes of a real package; validated stays false.
    build: { coreuiVersion: 1010, renditionCount: symbols.length * MASTERS.length, facetCount: symbols.length, validated: false },
    palette: 'stand-in',
    symbols: symbols.map((s) => ({
      name: s.data.name,
      aliases: [],
      categories: s.categories,
      searchTerms: s.searchTerms,
      year: s.year,
      // Format 2, as `generate` writes it.
      json: JSON.stringify(toWire(s.data)),
      facts: symbolFacts(s.data),
    })),
    categories: CATEGORIES.map(({ key, icon, label }) => ({ key, icon, label })),
  });
  process.stderr.write(`wrote ${symbols.length} synthetic symbols (seed ${opts.seed}) into ${opts.out}\n`);
}

await main();
