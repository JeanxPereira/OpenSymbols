// One SF Symbol → `SymbolData` (packages/core/src/format.ts), the generated-data contract.
import {
  FORMAT_VERSION,
  type LayerData,
  type LayerStyleData,
  type MasterData,
  type PaintData,
  type RenderMode,
  type SymbolData,
  type VariantData,
  metricCenter,
} from "@opensymbols/core";
import {
  DecodeError,
  type Catalog,
  type Drawing,
  type GlyphMetrics,
  type Layer,
  type LayerStyle,
  type Master,
  type PathCommand,
  type PickOptions,
  type SymbolEntry,
} from "@opensymbols/decode";
import { EncodeError } from "../errors.js";

/** Where a palette colour came from: the user's colors-26.csv, a fixed exact value, or a stand-in. */
export type ColourOrigin = "apple" | "exact" | "stand-in";

export type Palette = {
  /** "apple" when built over the user's colors-26.csv, else "stand-in". */
  source: "apple" | "stand-in";
  light: Map<string, string>;
  dark: Map<string, string>;
  /** Per colour name; every name in `light` has one. */
  origin: Map<string, ColourOrigin>;
};

export interface EncodeOptions {
  masters: "all" | "regular";
  palette: Palette;
  /** The catalog is the reference build (fingerprint.ts); written as `SymbolData.build.validated`. */
  validated: boolean;
  /**
   * Non-fatal notes are pushed here when given: an appearance that is neither 0 nor dark, a
   * (direction, appearance) pair with no rendition, a colour the palette does not name.
   */
  warnings?: string[];
}

const ALL_MODES: readonly RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];
/** The regular master first: it is the reference the others are checked against. */
const MASTERS: Record<EncodeOptions["masters"], readonly Master[]> = { all: [4, 1, 9], regular: [4] };

/** Glyph metrics are float32 in the catalog; 6 significant digits keep them exact enough and short. */
export function round6(n: number): number {
  const r = Number(n.toPrecision(6));
  return r === 0 ? 0 : r;
}

/** Path arguments are stored at 3 decimals; -0 becomes 0. */
export function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

interface Pair {
  direction: number | undefined;
  appearance: number | undefined;
}

/** Per-symbol encoding state: the palette, and whether any colour fell back to a stand-in. */
interface Ctx {
  name: string;
  palette: Palette;
  warnings: string[] | undefined;
  standIn: boolean;
  /** Colours already warned about, so a colour used on many layers warns once. */
  missing: Set<string>;
}

export function encodeSymbol(catalog: Catalog, entry: SymbolEntry, opts: EncodeOptions): SymbolData {
  const name = entry.name;
  const darkId = darkAppearance(catalog);
  const appearanceName = new Map([...catalog.appearances()].map(([n, id]) => [id, n]));

  // Docs/format/05 §4.4: an empty set means the axis does not vary; the pick then takes the one
  // stored value and the key says 0, as the runtime's pickVariant expects.
  const directions = entry.variants.direction.length > 0 ? entry.variants.direction : [undefined];
  const appearances = entry.variants.appearance.length > 0 ? entry.variants.appearance : [undefined];
  const pairs: Pair[] = [];
  for (const direction of directions) for (const appearance of appearances) pairs.push({ direction, appearance });
  // The default variant is the lowest (direction, appearance) pair; both lists are sorted.

  const ctx: Ctx = { name, palette: opts.palette, warnings: opts.warnings, standIn: false, missing: new Set() };
  const variants: Record<string, VariantData> = {};
  for (const pair of pairs) {
    const a = pair.appearance ?? 0;
    let aKey: string;
    if (a === 0) aKey = "a0";
    else if (a === darkId) aKey = "a1";
    else {
      aKey = `a${a}`;
      opts.warnings?.push(
        `symbol "${name}": appearance ${a} ("${appearanceName.get(a) ?? "?"}") is neither 0 nor dark; kept as "${aKey}", which the runtime never selects`,
      );
    }
    const key = `${aKey}d${pair.direction ?? 0}`;
    if (Object.hasOwn(variants, key)) {
      throw new EncodeError(name, `symbol "${name}": two variants share the key "${key}"`);
    }
    const variant = encodeVariant(catalog, entry, pair, opts, key, ctx);
    if (variant !== undefined) variants[key] = variant;
  }

  const keys = Object.keys(variants);
  if (keys.length === 0) {
    throw new EncodeError(name, `symbol "${name}": no (direction, appearance) pair has a rendition to encode`);
  }
  return {
    v: FORMAT_VERSION,
    name,
    // "apple" only when every named colour the symbol uses is Apple's or exact.
    palette: opts.palette.source === "apple" && !ctx.standIn ? "apple" : "stand-in",
    variants,
    defaultVariant: keys[0] as string,
    modes: modesOf(catalog, name),
    build: { validated: opts.validated },
  };
}

/**
 * The APPEARANCEKEYS id whose name contains "dark" (case-insensitive), if any; one without
 * "accessib" or "contrast" in its name (a high-contrast dark) is preferred.
 */
function darkAppearance(catalog: Catalog): number | undefined {
  let fallback: number | undefined;
  for (const [n, id] of catalog.appearances()) {
    if (!/dark/i.test(n)) continue;
    if (!/accessib|contrast/i.test(n)) return id;
    fallback ??= id;
  }
  return fallback;
}

/** Docs/format/05 §3.4: modes from layerset availability when the app files carry it. */
function modesOf(catalog: Catalog, name: string): RenderMode[] {
  const sets = catalog.appMetadata?.layersetAvailability;
  if (sets === undefined || sets.size === 0) return [...ALL_MODES];
  // A symbol the file does not list still has the two modes every symbol has.
  return [...(sets.get(name) ?? ["monochrome", "palette"])];
}

function encodeVariant(
  catalog: Catalog,
  entry: SymbolEntry,
  pair: Pair,
  opts: EncodeOptions,
  key: string,
  ctx: Ctx,
): VariantData | undefined {
  const name = entry.name;
  const pick: PickOptions = {};
  if (pair.direction !== undefined) pick.direction = pair.direction;
  if (pair.appearance !== undefined) pick.appearance = pair.appearance;

  // A sparse grid (dark stored for one direction only) has pairs with no rendition: those are
  // skipped. A pair whose rendition exists but does not decode fails the symbol.
  if (!catalog.hasRendition(name, 4, pick)) {
    opts.warnings?.push(`symbol "${name}": variant ${key} skipped: no regular-master rendition stored for it`);
    return undefined;
  }
  const regular = catalog.drawing(name, 4, pick);
  const drawings = new Map<Master, Drawing>([[4, regular]]);
  for (const m of MASTERS[opts.masters]) if (m !== 4) drawings.set(m, catalog.drawing(name, m, pick));

  let ops = "";
  const argCounts: number[] = [];
  const layers: LayerData[] = [];
  for (const layer of regular.layers) {
    const start = argCounts.length;
    for (const c of layer.path) {
      ops += c.op;
      argCounts.push(c.args.length);
    }
    layers.push(encodeLayer(layer, [start, argCounts.length], ctx));
  }

  const masters: VariantData["masters"] = {};
  for (const [m, d] of drawings) {
    if (m !== 4) checkCompatible(name, key, m, regular, d);
    const master: MasterData = {
      args: d.layers.flatMap((l) => l.path.flatMap((c) => c.args.map(round3))),
      viewBox: [...d.viewBox],
      transform: [...d.transform],
    };
    const metrics = metricsOf(catalog, name, m, pick);
    if (metrics === undefined) {
      // The runtime draws it all the same; only text layout needs metrics, and it flags them.
      opts.warnings?.push(
        `symbol "${name}": variant ${key} master ${m} has no glyph metrics (TLV 1018); text layout falls back to the box scale`,
      );
    } else {
      master.metrics = {
        referencePointSize: round6(metrics.referencePointSize),
        baselineOffset: round6(metrics.baselineOffset),
        capHeight: round6(metrics.capHeight),
        leftInset: round6(metrics.leftInset),
        rightInset: round6(metrics.rightInset),
      };
      // 06 section 9.3: from this master's own metrics, viewBox and transform.
      const centre = metricCenter(master.viewBox, master.transform, master.metrics);
      if (centre !== undefined) master.metricCenter = [round3(centre[0]), round3(centre[1])];
    }
    // 06 section 9.2: each master's document carries its own marker (already in path space).
    if (d.rotationAnchor !== undefined) master.rotationAnchor = [round3(d.rotationAnchor[0]), round3(d.rotationAnchor[1])];
    masters[m] = master;
  }

  // [INF] Animation fields are read from master 4 only; masters 1 and 9 are not compared on
  // them (an animation parameter that varied by weight would be lost).
  const anim: Record<string, unknown> = {
    drawReversesMotionGroups: regular.drawReversesMotionGroups,
    wiggleStyle: regular.wiggleStyle,
    wiggleAngle: regular.wiggleAngle,
    rotatesClockwise: regular.rotatesClockwise,
    shapeGroups: regular.shapeGroups,
    drawAttachmentData: regular.drawAttachmentData,
  };
  return {
    ops,
    argCounts,
    masters,
    layers,
    variableValueMode: regular.variableValueMode,
    vcContinuous: regular.vcContinuous,
    anim: defined(anim),
  };
}

/**
 * The rendition's glyph metrics, or undefined when it has none. `catalog.metrics` picks the same
 * rendition `catalog.drawing` just decoded, so a DecodeError here can only be the missing TLV.
 */
function metricsOf(catalog: Catalog, name: string, m: Master, pick: PickOptions): GlyphMetrics | undefined {
  try {
    return catalog.metrics(name, m, pick);
  } catch (e) {
    if (e instanceof DecodeError) return undefined;
    throw e;
  }
}

/** Review Focus 1: a master whose commands differ from the regular's cannot be interpolated. */
function checkCompatible(name: string, key: string, m: Master, regular: Drawing, other: Drawing): void {
  const fail = (what: string): never => {
    throw new EncodeError(
      name,
      `symbol "${name}" variant ${key}: master ${m} is not point-compatible with master 4: ${what}`,
    );
  };
  if (other.layers.length !== regular.layers.length) {
    fail(`${other.layers.length} layers, master 4 has ${regular.layers.length}`);
  }
  regular.layers.forEach((rl, i) => {
    const ol = other.layers[i] as Layer;
    const n = Math.max(rl.path.length, ol.path.length);
    for (let j = 0; j < n; j++) {
      const rc = rl.path[j];
      const oc = ol.path[j];
      const at = `layer ${i} command ${j}`;
      if (rc === undefined) fail(`${at}: extra command "${(oc as PathCommand).op}" (master 4 ends at ${j})`);
      if (oc === undefined) fail(`${at}: missing; master 4 has "${rc!.op}" (master ${m} ends at ${j})`);
      if (rc!.op !== oc!.op) fail(`${at}: op "${oc!.op}", master 4 has "${rc!.op}"`);
      if (rc!.args.length !== oc!.args.length) {
        fail(`${at} ("${rc!.op}"): ${oc!.args.length} arguments, master 4 has ${rc!.args.length}`);
      }
    }
  });
}

function encodeLayer(layer: Layer, cmd: [number, number], ctx: Ctx): LayerData {
  const modes = {} as Record<RenderMode, LayerStyleData>;
  for (const m of ALL_MODES) modes[m] = encodeStyle(layer.modes[m], ctx);
  const out: LayerData = { cmd, role: layer.role, modes, motionGroup: layer.motionGroup };
  if (layer.variableThreshold !== undefined) out.variableThreshold = layer.variableThreshold;
  out.anim = defined({
    tags: layer.tags,
    alwaysRotates: layer.alwaysRotates,
    alwaysPulses: layer.alwaysPulses,
    strokeKeyframes: layer.strokeKeyframes,
    familyLayer: layer.familyLayer,
    attachments: layer.attachments,
    variableDraw: layer.variableDraw,
  });
  return out;
}

function encodeStyle(style: LayerStyle, ctx: Ctx): LayerStyleData {
  return { paint: encodePaint(style.paint, ctx), opacity: style.opacity, clearBehind: style.clearBehind };
}

function encodePaint(paint: LayerStyle["paint"], ctx: Ctx): PaintData {
  switch (paint.kind) {
    case "tint":
      return { kind: "tint" };
    case "role":
      return { kind: "role", role: paint.role };
    case "fixed":
      return { kind: "fixed", hex: paint.hex.toLowerCase() };
    case "named": {
      const { palette } = ctx;
      const light = palette.light.get(paint.name);
      const dark = palette.dark.get(paint.name);
      if (light === undefined || dark === undefined) {
        // `custom` without a fill, a local colour name: nothing to draw it with but the tint.
        ctx.standIn = true;
        if (!ctx.missing.has(paint.name)) {
          ctx.missing.add(paint.name);
          ctx.warnings?.push(
            `symbol "${ctx.name}": colour "${paint.name}" is not in the palette; drawn in the tint`,
          );
        }
        return { kind: "tint" };
      }
      const origin = palette.origin.get(paint.name);
      if (origin !== "apple" && origin !== "exact") ctx.standIn = true;
      return { kind: "named", name: paint.name, light, dark };
    }
    case "none":
      // 06 §4.4: reserved; no rule of this build produces it.
      throw new EncodeError(ctx.name, `symbol "${ctx.name}": a layer has paint "none", which the runtime cannot draw`);
  }
}

function defined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}
