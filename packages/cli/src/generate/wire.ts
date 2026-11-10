// `SymbolData` (what encode builds) → `SymbolWire`, format 2 (packages/core/src/format.ts), the
// form the symbol modules carry. `decodeSymbol` in core is its exact inverse.
import type {
  LayerData,
  LayerStyleData,
  LayerStyleWire,
  LayerWire,
  MasterData,
  MasterWire,
  RenderMode,
  SymbolData,
  SymbolWire,
  VariantData,
  VariantWire,
} from "@opensymbols/core";

const MODES: readonly RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

/** The layer `anim` keys format 2 drops at their default value, and the test for that default. */
const ANIM_DEFAULTS: ReadonlyArray<[string, (v: unknown) => boolean]> = [
  ["alwaysRotates", (v) => v === false],
  ["alwaysPulses", (v) => v === false],
  ["tags", (v) => Array.isArray(v) && v.length === 0],
  ["strokeKeyframes", (v) => Array.isArray(v) && v.length === 0],
  ["attachments", (v) => Array.isArray(v) && v.length === 0],
];

/** 3 decimals, as args are stored; -0 becomes 0. */
function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/**
 * The format 2 delta of args stored at 3 decimals: `d[i] = a[i] − a[i − 2]` for `i ≥ 2`. Each
 * difference is taken against the value the decoder will rebuild (`d[i] + a'[i − 2]`) and kept at
 * 3 decimals, so float error never accumulates along the path; integer args (every arg of the
 * reference catalog) come back exactly.
 */
export function deltaArgs(a: readonly number[]): number[] {
  const d = new Array<number>(a.length);
  const rebuilt = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    if (i < 2) {
      d[i] = a[i]!;
      rebuilt[i] = a[i]!;
    } else {
      d[i] = round3(a[i]! - rebuilt[i - 2]!);
      rebuilt[i] = d[i]! + rebuilt[i - 2]!;
    }
  }
  return d;
}

function style(s: LayerStyleData): LayerStyleWire {
  const out: LayerStyleWire = { paint: s.paint };
  if (s.opacity !== 1) out.opacity = s.opacity;
  if (s.clearBehind) out.clearBehind = true;
  return out;
}

function layer(l: LayerData): LayerWire {
  const modes = {} as Record<RenderMode, LayerStyleWire>;
  for (const m of MODES) modes[m] = style(l.modes[m]);
  const out: LayerWire = { cmd: l.cmd, role: l.role, modes, motionGroup: l.motionGroup };
  if (l.variableThreshold !== undefined) out.variableThreshold = l.variableThreshold;
  if (l.anim !== undefined) {
    const anim: Record<string, unknown> = { ...l.anim };
    for (const [k, isDefault] of ANIM_DEFAULTS) if (k in anim && isDefault(anim[k])) delete anim[k];
    if (Object.keys(anim).length > 0) out.anim = anim;
  }
  return out;
}

function master(m: MasterData): MasterWire {
  return { ...m, args: deltaArgs(m.args) };
}

function variant(v: VariantData): VariantWire {
  const masters: VariantWire["masters"] = {};
  for (const key of [1, 4, 9] as const) {
    const m = v.masters[key];
    if (m !== undefined) masters[key] = master(m);
  }
  const out: VariantWire = {
    ops: v.ops,
    masters,
    layers: v.layers.map(layer),
    variableValueMode: v.variableValueMode,
    vcContinuous: v.vcContinuous,
  };
  if (v.anim !== undefined) out.anim = v.anim;
  return out;
}

function variants(r: Record<string, VariantData>): Record<string, VariantWire> {
  const out: Record<string, VariantWire> = {};
  for (const [k, v] of Object.entries(r)) out[k] = variant(v);
  return out;
}

/**
 * Format 2 of `data`: args delta-encoded, no `argCounts`, layer styles without `opacity: 1` and
 * `clearBehind: false`, layer `anim` without its default-valued keys. Every op must be one of
 * `M L Q C Z` with its arity (normalized paths are), which `decodeSymbol` relies on.
 */
export function toWire(data: SymbolData): SymbolWire {
  const out: SymbolWire = {
    v: 2,
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
  return out;
}
