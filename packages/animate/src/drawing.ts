import { argOffsets, viewBoxToPath } from "@opensymbols/core";
import type { Interpolated, RenderMode, Role, Transform, VariantData, ViewBox } from "@opensymbols/core";
import { strokeLength } from "./clip/cut.js";
import { LAYER_FLAG } from "./keyframes.js";

/** One clip-stroke keyframe record (Docs/format/06 §6, 08 §5). */
export interface StrokeKeyframe {
  flags: number;
  progress: number;
  d0: number;
  d1: number;
}

/** A clip-stroke attachment (Docs/format/06 §6, 08 §11.1). */
export interface StrokeAttachment {
  flags: number;
  targetLayer: number;
  targetSubpath: number;
  dataIndex: number;
  riders: number[];
}

/** A layer's own commands, sliced once from the variant. */
export interface AnimPath {
  ops: string;
  argCounts: number[];
  args: number[];
}

export interface AnimLayer {
  path: AnimPath;
  role: Role;
  motionGroup: number;
  /** The compacted motion group, 0 … groupCount − 1, ascending by id (07 §4.1). */
  group: number;
  /** Per rendering mode: the layer is an eraser (07 §2.2 flag 0). */
  clearBehind: Record<RenderMode, boolean>;
  tags: string[];
  alwaysRotates: boolean;
  alwaysPulses: boolean;
  strokeKeyframes: StrokeKeyframe[];
  familyLayer: number;
  attachments: StrokeAttachment[];
  variableThreshold?: number;
  /**
   * The dense 1-based rank of the layer's finite `variableThreshold` among the drawing's distinct
   * thresholds, ascending; equal thresholds share a rank; −1 without one (07 §2.2 index mode 3, §9.5).
   */
  rank: number;
  variableDraw?: [number, number];
  /** Some layer of its family keyframes its stroke or declares attachments (08 §2). */
  strokable: boolean;
  /** 07 §2.2 layer flags except the eraser bit, which depends on the rendering mode. */
  flags: number;
  /**
   * The stroke length in point sizes (08 §3), which sets the layer's Draw duration (07 §7.8). Filled
   * by the stroke clip (08); absent counts as 0.
   */
  strokeLength?: number;
  /** Bounding box of the on-curve points `[minX, minY, maxX, maxY]`, path space; undefined when empty. */
  bounds?: [number, number, number, number];
}

/** What the engine reads of one variant at one weight. */
export interface AnimDrawing {
  /** The symbol's name, when known: Magic Replace drops tags that name the symbol (07 §7.10). */
  name?: string;
  layers: AnimLayer[];
  /** Distinct motion groups (07 §4.1). */
  groupCount: number;
  /** Distinct finite thresholds, `n` of Variable Color's animated forms (07 §9.5). */
  rankCount: number;
  viewBox: ViewBox;
  transform: Transform;
  /** Points per unit of a translation value: the reference point size, else the viewBox height (07 §2.6). */
  pointSize: number;
  /** Pivot of scale and symbol rotation, path space (07 §2.5). Resolved: never absent. */
  metricCenter: [number, number];
  /** Pivot of layer rotation, path space; the metric centre when the document has none (07 §2.5). */
  rotationAnchor: [number, number];
  /** Pivot of the badge scale: the centre of the `_badge` layers' bounds, else the metric centre (07 §2.5). */
  badgeCenter: [number, number];
  drawReversesMotionGroups: boolean;
  wiggleStyle?: "linear" | "clockwise" | "counterClockwise";
  wiggleAngle?: number;
  rotatesClockwise?: boolean;
  shapeGroups: unknown[];
  drawAttachmentData: Array<{ a: number; b: number; anchorX: number; anchorY: number }>;
  variableValueMode: "color" | "draw";
  vcContinuous: boolean;
}

// ---- defensive readers for the untyped `anim` records ----

const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function strokeKeyframes(v: unknown): StrokeKeyframe[] {
  return arr(v)
    .filter(isRecord)
    .map((k) => ({ flags: num(k.flags) ?? 0, progress: num(k.progress) ?? 0, d0: num(k.d0) ?? 0, d1: num(k.d1) ?? 0 }));
}

function attachments(v: unknown): StrokeAttachment[] {
  return arr(v)
    .filter(isRecord)
    .map((a) => ({
      flags: num(a.flags) ?? 0,
      targetLayer: num(a.targetLayer) ?? -1,
      targetSubpath: num(a.targetSubpath) ?? -1,
      dataIndex: num(a.dataIndex) ?? -1,
      riders: arr(a.riders).filter((r): r is number => typeof r === "number"),
    }));
}

function pair(v: unknown): [number, number] | undefined {
  const a = arr(v);
  const x = num(a[0]);
  const y = num(a[1]);
  return a.length === 2 && x !== undefined && y !== undefined ? [x, y] : undefined;
}

// ---- on-curve points ----

/** SVG operand count per command letter (Docs/format/03 §2). */
const ARITY: Record<string, number> = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, H: 1, V: 1, Z: 0 };

/** Bounding box of the on-curve points (end points of every command), relative commands resolved. */
function onCurveBounds(path: AnimPath): [number, number, number, number] | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let k = 0;
  const add = () => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (let i = 0; i < path.ops.length; i++) {
    const op = path.ops[i]!;
    const n = path.argCounts[i] ?? 0;
    const upper = op.toUpperCase();
    const rel = op !== upper;
    const arity = ARITY[upper];
    if (arity === undefined) {
      k += n;
      continue;
    }
    if (upper === "Z") {
      x = sx;
      y = sy;
      k += n;
      continue;
    }
    // A count that is a multiple of the arity repeats the command (SVG implicit repetition).
    for (let j = 0; j + arity <= n; j += arity) {
      const at = k + j;
      if (upper === "H") x = (rel ? x : 0) + path.args[at]!;
      else if (upper === "V") y = (rel ? y : 0) + path.args[at]!;
      else {
        x = (rel ? x : 0) + path.args[at + arity - 2]!;
        y = (rel ? y : 0) + path.args[at + arity - 1]!;
      }
      if (upper === "M" && j === 0) {
        sx = x;
        sy = y;
      }
      if (Number.isFinite(x) && Number.isFinite(y)) add();
    }
    k += n;
  }
  return minX <= maxX ? [minX, minY, maxX, maxY] : undefined;
}

function union(boxes: Array<[number, number, number, number] | undefined>): [number, number, number, number] | undefined {
  let out: [number, number, number, number] | undefined;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : [...b];
  }
  return out;
}

const centre = (b: [number, number, number, number]): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

const ENCLOSURE_TAGS = new Set(["_enclosure.stroke", "_enclosure.fill"]);

/**
 * The engine's view of `variant` at the weight `interpolated` was computed for. Each layer's
 * commands are sliced once; nothing else is copied. `name` is the symbol's (`SymbolData.name`),
 * which Magic Replace needs to compare tags (07 §7.10).
 */
export function toAnimDrawing(variant: VariantData, interpolated: Interpolated, name?: string): AnimDrawing {
  const offsets = argOffsets(variant.argCounts);
  const doc = variant.anim ?? {};

  // 07 §4.1: compact the distinct motion groups to 0 … n−1, ascending by id.
  const ids = [...new Set(variant.layers.map((l) => l.motionGroup))].sort((a, b) => a - b);
  const groupOf = new Map(ids.map((id, i) => [id, i]));

  const layers: AnimLayer[] = variant.layers.map((l) => {
    const a = l.anim ?? {};
    const [c0, c1] = l.cmd;
    const path: AnimPath = {
      ops: variant.ops.slice(c0, c1),
      argCounts: variant.argCounts.slice(c0, c1),
      args: interpolated.args.slice(offsets[c0] ?? 0, offsets[c1] ?? 0),
    };
    const tags = strings(a.tags);
    const out: AnimLayer = {
      path,
      role: l.role,
      motionGroup: l.motionGroup,
      group: groupOf.get(l.motionGroup) ?? 0,
      clearBehind: {
        monochrome: l.modes.monochrome?.clearBehind === true,
        hierarchical: l.modes.hierarchical?.clearBehind === true,
        multicolor: l.modes.multicolor?.clearBehind === true,
        palette: l.modes.palette?.clearBehind === true,
      },
      tags,
      alwaysRotates: bool(a.alwaysRotates),
      alwaysPulses: bool(a.alwaysPulses),
      strokeKeyframes: strokeKeyframes(a.strokeKeyframes),
      familyLayer: num(a.familyLayer) ?? -1,
      attachments: attachments(a.attachments),
      strokable: false,
      rank: -1,
      flags: 0,
    };
    if (l.variableThreshold !== undefined) out.variableThreshold = l.variableThreshold;
    const vd = pair(a.variableDraw);
    if (vd) out.variableDraw = vd;
    const b = onCurveBounds(path);
    if (b) out.bounds = b;
    return out;
  });

  // 08 §2 [INF]: a family (same familyLayer ≥ 0; −1 is its own family) is strokable when some
  // member keyframes its stroke or declares attachments.
  const strokingFamilies = new Set<number>();
  for (const l of layers) {
    if (l.familyLayer >= 0 && (l.strokeKeyframes.length > 0 || l.attachments.length > 0)) strokingFamilies.add(l.familyLayer);
  }
  for (const l of layers) {
    l.strokable = l.familyLayer >= 0 ? strokingFamilies.has(l.familyLayer) : l.strokeKeyframes.length > 0 || l.attachments.length > 0;
    // 07 §2.2 layer flags (the eraser bit is added per rendering mode when sampling).
    let f = 0;
    if (l.tags.includes("_slash")) f |= LAYER_FLAG.slash;
    if (l.tags.includes("_badge")) f |= LAYER_FLAG.badge;
    if (l.tags.some((t) => ENCLOSURE_TAGS.has(t))) f |= LAYER_FLAG.enclosure;
    if (l.strokable) f |= LAYER_FLAG.stroke;
    if (l.alwaysPulses) f |= LAYER_FLAG.alwaysPulses;
    if (l.alwaysRotates) f |= LAYER_FLAG.alwaysRotates;
    l.flags = f;
  }

  // 07 §9.5: the threshold ladder. Distinct finite thresholds ascending; each layer with one takes
  // the dense 1-based rank of its value (equal values share a rank) and the flag 0x20.
  const thresholds = [...new Set(layers.map((l) => l.variableThreshold).filter((t): t is number => t !== undefined && Number.isFinite(t)))].sort(
    (a, b) => a - b,
  );
  const rankOf = new Map(thresholds.map((t, i) => [t, i + 1]));
  for (const l of layers) {
    const r = l.variableThreshold === undefined ? undefined : rankOf.get(l.variableThreshold);
    if (r === undefined) continue;
    l.rank = r;
    l.flags |= LAYER_FLAG.hasThreshold;
  }

  const { viewBox, transform } = interpolated;
  // 08 §3 [INF]: L_path = the maximum over the family's layers and their (joined) subpaths of the
  // speed v, in path units; in point sizes through the transform's uniform scale s = sqrt|ad − bc|
  // over referencePointSize, the viewBox height standing in without metrics.
  const pointSize = interpolated.metrics?.referencePointSize ?? viewBox[3];
  const s = Math.sqrt(Math.abs(transform[0] * transform[3] - transform[1] * transform[2]));
  const own = layers.map((l) => (l.strokable && l.strokeKeyframes.length > 0 ? strokeLength(l.path, l.strokeKeyframes) : 0));
  const familyMax = new Map<number, number>();
  layers.forEach((l, i) => {
    if (l.familyLayer >= 0) familyMax.set(l.familyLayer, Math.max(familyMax.get(l.familyLayer) ?? 0, own[i]!));
  });
  layers.forEach((l, i) => {
    if (!l.strokable) return;
    const L = l.familyLayer >= 0 ? familyMax.get(l.familyLayer)! : own[i]!;
    const len = pointSize > 0 ? (L * s) / pointSize : 0;
    l.strokeLength = Number.isFinite(len) ? len : 0;
  });

  // 07 §2.5 [INF]: without a metric centre, the centre of the bounding box of all layers'
  // on-curve points; with no points at all, the viewBox centre in path space.
  const all = union(layers.map((l) => l.bounds));
  const metricCenter: [number, number] =
    interpolated.metricCenter ??
    (all ? centre(all) : viewBoxToPath(transform, viewBox[0] + viewBox[2] / 2, viewBox[1] + viewBox[3] / 2) ?? [0, 0]);
  const badge = union(layers.filter((l) => l.flags & LAYER_FLAG.badge).map((l) => l.bounds));

  const out: AnimDrawing = {
    layers,
    groupCount: ids.length,
    rankCount: thresholds.length,
    viewBox,
    transform,
    // 07 §2.6: the reference point size, else the viewBox height [INF].
    pointSize,
    metricCenter,
    rotationAnchor: interpolated.rotationAnchor ?? metricCenter,
    badgeCenter: badge ? centre(badge) : metricCenter,
    drawReversesMotionGroups: bool(doc.drawReversesMotionGroups),
    shapeGroups: arr(doc.shapeGroups),
    drawAttachmentData: arr(doc.drawAttachmentData)
      .filter(isRecord)
      .map((x) => ({ a: num(x.a) ?? 0, b: num(x.b) ?? 0, anchorX: num(x.anchorX) ?? 0, anchorY: num(x.anchorY) ?? 0 })),
    variableValueMode: variant.variableValueMode,
    vcContinuous: variant.vcContinuous,
  };
  if (name !== undefined) out.name = name;
  const ws = doc.wiggleStyle;
  if (ws === "linear" || ws === "clockwise" || ws === "counterClockwise") out.wiggleStyle = ws;
  const wa = num(doc.wiggleAngle);
  if (wa !== undefined) out.wiggleAngle = wa;
  if (typeof doc.rotatesClockwise === "boolean") out.rotatesClockwise = doc.rotatesClockwise;
  return out;
}
