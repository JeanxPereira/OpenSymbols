import type {
  LayerData,
  LayerStyleData,
  LayerStyleWire,
  LayerWire,
  MasterData,
  RenderMode,
  SymbolData,
  SymbolWire,
  VariantData,
  VariantWire,
} from "./format.js";

/** Values per step of each op a format 2 path holds (normalized paths, Docs/format/03 §7). */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

/** The anim keys format 2 drops at their default, and that default. */
const ANIM_DEFAULTS: ReadonlyArray<[string, () => unknown]> = [
  ["alwaysRotates", () => false],
  ["alwaysPulses", () => false],
  ["tags", () => []],
  ["strokeKeyframes", () => []],
  ["attachments", () => []],
];

const MODES: readonly RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

/** Each op's argument count, from its arity. An op outside `M L Q C Z` is a TypeError. */
export function argCountsOf(ops: string): number[] {
  const out = new Array<number>(ops.length);
  for (let i = 0; i < ops.length; i++) {
    const n = ARITY[ops[i]!];
    if (n === undefined) throw new TypeError(`op "${ops[i]}" at ${i} is not a format 2 op (M L Q C Z)`);
    out[i] = n;
  }
  return out;
}

/**
 * Args carry at most 3 decimals (the generator rounds them so); every sum and difference is rounded
 * back to 3 decimals, so float error never accumulates along a path and the round trip is exact.
 */
const round3 = (x: number): number => Math.round(x * 1000) / 1000 + 0;

/** Inverse of the format 2 delta: `a[i] = d[i] + a[i − 2]`, rounded to 3 decimals. */
export function undelta(d: readonly number[]): number[] {
  const a = d.slice();
  for (let i = 2; i < a.length; i++) a[i] = round3(a[i]! + a[i - 2]!);
  return a;
}

/** The format 2 delta of absolute args: `d[i] = a[i] − a[i − 2]` for `i ≥ 2`, rounded to 3 decimals. */
export function delta(a: readonly number[]): number[] {
  const d = a.slice();
  for (let i = a.length - 1; i >= 2; i--) d[i] = round3(a[i]! - a[i - 2]!);
  return d;
}

function style(s: LayerStyleWire): LayerStyleData {
  return { paint: s.paint, opacity: s.opacity ?? 1, clearBehind: s.clearBehind === true };
}

function layer(l: LayerWire): LayerData {
  const modes = {} as Record<RenderMode, LayerStyleData>;
  for (const m of MODES) modes[m] = style(l.modes[m]);
  const out: LayerData = { cmd: l.cmd, role: l.role, modes, motionGroup: l.motionGroup };
  if (l.variableThreshold !== undefined) out.variableThreshold = l.variableThreshold;
  const anim: Record<string, unknown> = { ...(l.anim ?? {}) };
  for (const [k, def] of ANIM_DEFAULTS) if (!(k in anim)) anim[k] = def();
  out.anim = anim;
  return out;
}

function variant(v: VariantWire): VariantData {
  const argCounts = argCountsOf(v.ops);
  const total = argCounts.reduce((s, n) => s + n, 0);
  const masters: VariantData["masters"] = {};
  for (const key of [1, 4, 9] as const) {
    const m = v.masters[key];
    if (m === undefined) continue;
    if (m.args.length !== total) {
      throw new TypeError(`master ${key} has ${m.args.length} args; its ops need ${total}`);
    }
    const out: MasterData = { ...m, args: undelta(m.args) };
    masters[key] = out;
  }
  const out: VariantData = {
    ops: v.ops,
    argCounts,
    masters,
    layers: v.layers.map(layer),
    variableValueMode: v.variableValueMode,
    vcContinuous: v.vcContinuous,
  };
  if (v.anim !== undefined) out.anim = v.anim;
  return out;
}

function variants(r: Record<string, VariantWire>): Record<string, VariantData> {
  const out: Record<string, VariantData> = {};
  for (const [k, v] of Object.entries(r)) out[k] = variant(v);
  return out;
}

const cache = new WeakMap<object, SymbolData>();

/**
 * The in-memory form of generated data: format 1 is returned as is; format 2 is expanded (args
 * summed back, `argCounts` from the ops, defaults restored) once per object and cached. Any other
 * version is a TypeError.
 */
export function decodeSymbol(data: SymbolData | SymbolWire): SymbolData {
  if (data.v === 1) return data;
  if (data.v !== 2) throw new TypeError(`Unsupported OpenSymbols data version ${String((data as { v: unknown }).v)}`);
  const hit = cache.get(data);
  if (hit) return hit;
  const out: SymbolData = {
    v: 1,
    name: data.name,
    palette: data.palette,
    variants: variants(data.variants),
    defaultVariant: data.defaultVariant,
    modes: data.modes,
    build: data.build,
  };
  if (data.locales !== undefined) {
    out.locales = {};
    for (const [tag, set] of Object.entries(data.locales)) out.locales[tag] = variants(set);
  }
  cache.set(data, out);
  return out;
}
