import type { MasterData, MasterMetrics, Transform, VariantData, ViewBox, Weight } from "./format.js";

const WEIGHT_NAMES: Record<string, number> = {
  ultralight: 1,
  thin: 2,
  light: 3,
  regular: 4,
  medium: 5,
  semibold: 6,
  bold: 7,
  heavy: 8,
  black: 9,
};

/** Names map to 1..9; numbers clamp to [1, 9]; NaN is regular. An unknown name is a TypeError. */
export function weightValue(w: Weight): number {
  if (typeof w === "string") {
    const n = Object.hasOwn(WEIGHT_NAMES, w) ? WEIGHT_NAMES[w] : undefined;
    if (n === undefined) throw new TypeError(`unknown weight "${w}"`);
    return n;
  }
  if (Number.isNaN(w)) return 4;
  return Math.min(9, Math.max(1, w));
}

/** The symbol scale: Small, Medium or Large (Docs/format/01 section 5.4). */
export type Scale = "small" | "medium" | "large";

/**
 * CoreUI's continuous glyph size `S` per scale (`_CUIVectorGlyphContinuousSize{Small,Medium,Large}`):
 * the size row of the weight table and the factor the glyph is drawn at.
 */
export const SCALE_SIZE: Readonly<Record<Scale, number>> = { small: 1.0, medium: 1.276, large: 1.647 };

/**
 * The cap-height midline as a fraction of the reference point size (CoreUI `qword_18B592950`,
 * float64 `3FD68C0000000000`): a scaled glyph's baseline moves by `K·(S − 1)·X`.
 */
export const BASELINE_K = 0.352294921875;

/** The table's six continuous sizes (`_kCoreThemeContinuousGlyphInternalSizes`). */
const SIZES = [0.2, 0.5, 1.0, 1.276, 1.647, 2.0];

/**
 * `+[CUIVectorGlyphMutator _interpolationData]` (CoreUI 26A5416b): per size, per weight 1..9
 * (continuous keys −0.8, −0.6, −0.4, 0, 0.23, 0.3, 0.4, 0.56, 0.62), the pair (ultralight scalar,
 * black scalar), float64 exactly as stored. The XLarge row as read holds eight weights: Black is
 * not recorded, and `scalarsAtSize` extends that row from its last segment ([INF]).
 */
const TABLE: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // XXSmall 0.2
  [[0.0115, 0.0221], [0.0, 0.0661], [0.0, 0.435], [0.0, 0.6924], [0.0, 0.8145], [0.0, 0.9057], [-0.006, 0.9609], [0.0, 1.1061], [-0.1324, 1.132]],
  // XSmall 0.5
  [[0.6338, 0.0], [0.2328, 0.0], [-0.0528, 0.2287], [-0.0715, 0.4969], [-0.0715, 0.6859], [-0.0715, 0.7909], [-0.0739, 0.8937], [-0.076, 1.08], [-0.1325, 1.1847]],
  // Small 1.0
  [[1.0, 0.0], [0.7741935483870966, 0.0], [0.3333333333333333, 0.0], [0.0, 0.0], [0.0, 0.18], [0.0, 0.318], [0.0, 0.5], [0.0, 0.7639789473684211], [0.0, 1.0]],
  // Medium 1.276
  [
    [1.0680143742402992, 0.0], [0.8679677704534828, 0.0], [0.47740059163160353, 0.0], [0.18209370032725572, 0.0],
    [0.14843750853532175, 0.1649529780564263], [0.12263442816150573, 0.2914169278996865], [0.08860427868299477, 0.45820271682340646],
    [0.039241864054824986, 0.7001337513061651], [-0.004885142961266188, 0.9164054336468129],
  ],
  // Large 1.647
  [
    [1.1353465978260868, 0.0], [0.9624792734922861, 0.0], [0.624976402173913, 0.0], [0.3697913043478261, 0.0],
    [0.30034952162225337, 0.13072859799999997], [0.24711082153264766, 0.2309538564666666], [0.1768974634434575, 0.36313499444444436],
    [0.07504951544595084, 0.5548702715111109], [0.01599637746091113, 0.7262699888888887],
  ],
  // XLarge 2.0 (no Black entry)
  [[1.1162, -0.0495], [1.0524, -0.0104], [0.7878, 0.0], [0.5464, 0.0], [0.4641, 0.1072], [0.3875, 0.2173], [0.2925, 0.352], [0.1862, 0.5134]],
];

export type Scalars = { ul: number; b: number };

/**
 * The scalars of one size row at weight `w` (1..9 scale). An integer weight is the stored pair;
 * between two weights the pair blends linearly (equal to CoreUI's blend in its continuous keys,
 * which are linear between the same neighbours); outside the row it extrapolates from the end
 * segment, unclamped, as CoreUI does.
 */
function scalarsAtSize(row: ReadonlyArray<readonly [number, number]>, w: number): Scalars {
  const i = w - 1;
  if (Number.isInteger(i) && i >= 0 && i < row.length) return { ul: row[i]![0], b: row[i]![1] };
  const lo = Math.min(Math.max(Math.floor(i), 0), row.length - 2);
  const t = i - lo;
  const p = row[lo]!;
  const q = row[lo + 1]!;
  return { ul: p[0] + (q[0] - p[0]) * t, b: p[1] + (q[1] - p[1]) * t };
}

/**
 * CoreUI's weight scalars `(ul, b)` for weight `w` (1..9 scale) at continuous glyph size `size`
 * (`SCALE_SIZE`: 1 Small, 1.276 Medium, 1.647 Large), from `+[CUIVectorGlyphMutator
 * scalarsForGlyphContinuousWeight:glyphContinuousSize:]`: a table key is returned exactly, a
 * fractional weight interpolates linearly between its neighbouring keys, a size between rows
 * bilinearly. Nothing is clamped: values beyond the table extrapolate from its end segments.
 * Applied as `p = R + ul·(UL − R) + b·(B − R)`.
 */
export function weightScalars(w: number, size: number): Scalars {
  const exact = SIZES.indexOf(size);
  if (exact >= 0) return scalarsAtSize(TABLE[exact]!, w);
  let lo = 0;
  while (lo < SIZES.length - 2 && size > SIZES[lo + 1]!) lo++;
  const t = (size - SIZES[lo]!) / (SIZES[lo + 1]! - SIZES[lo]!);
  const p = scalarsAtSize(TABLE[lo]!, w);
  const q = scalarsAtSize(TABLE[lo + 1]!, w);
  return { ul: p.ul + (q.ul - p.ul) * t, b: p.b + (q.b - p.b) * t };
}

export interface Interpolated {
  args: number[];
  /** The interpolated viewBox scaled by `S` about the origin. */
  viewBox: ViewBox;
  /** The interpolated document transform, its output scaled by `S` (the glyph is drawn `S` times larger). */
  transform: Transform;
  /**
   * Undefined when a master the weight draws from has no metrics. Insets scaled by `S`, the
   * baseline offset moved to `S·b + K·(S − 1)·referencePointSize`; cap height and reference point
   * size are not scaled.
   */
  metrics?: MasterMetrics;
  /** Path space, interpolated like the metrics; scaled with the glyph through `transform`. Undefined when a used master lacks it (06 section 9.2). */
  rotationAnchor?: [number, number];
  /** Same rule (06 section 9.3). */
  metricCenter?: [number, number];
  /** Not exact: equal to `masterMissing` (the table's scalars are exact for every weight and scale). */
  approximate: boolean;
  /**
   * The weight leans toward ultralight (< 4) or black (> 4) and that master is not stored: its
   * scalar counts as 0. Not raised at regular, whatever the scale.
   */
  masterMissing: boolean;
}

const mix = (r: number, ul: number, b: number, s: Scalars): number => r + s.ul * (ul - r) + s.b * (b - r);

function mixArray<T extends number[]>(r: T, ul: T, b: T, s: Scalars): T {
  return r.map((v, i) => mix(v, ul[i] ?? v, b[i] ?? v, s)) as T;
}

const METRIC_KEYS = ["referencePointSize", "baselineOffset", "capHeight", "leftInset", "rightInset"] as const;

/**
 * The variant's shape at weight `w` and `scale` (default "medium", like the props): CoreUI's
 * scalars for that weight and size applied to args, viewBox, transform, metrics and anchors, then
 * the scale `S` (Docs/format/01 section 5.4). [OBS] Whether CoreUI interpolates the document
 * transform is not established; it is interpolated like the rest, as before.
 */
export function interpolate(variant: VariantData, w: Weight, scale: Scale = "small"): Interpolated {
  const wv = weightValue(w);
  const S = Object.hasOwn(SCALE_SIZE, scale) ? SCALE_SIZE[scale] : undefined;
  if (S === undefined) throw new TypeError(`unknown scale "${String(scale)}"`);
  const R = variant.masters[4];
  if (!R) throw new TypeError("variant has no regular master (4): generated data is malformed");
  const UL = variant.masters[1];
  const B = variant.masters[9];
  const s = weightScalars(wv, S);
  // Flagged only when the missing master would contribute at Small, i.e. the weight is not
  // regular: Regular at Medium/Large (ul 0.182 / 0.370) in a regular-only package is not flagged.
  const masterMissing = (wv < 4 && UL === undefined) || (wv > 4 && B === undefined);

  // A missing master's scalar counts as 0: `R + x·(R − R)` keeps only the stored masters.
  const ul: MasterData = UL ?? R;
  const b: MasterData = B ?? R;
  // Metrics only when every master given a non-zero scalar (and regular) has them.
  const rm = R.metrics;
  const um = s.ul !== 0 ? ul.metrics : rm;
  const bm = s.b !== 0 ? b.metrics : rm;
  let metrics: MasterMetrics | undefined;
  if (rm !== undefined && um !== undefined && bm !== undefined) {
    const m = {} as MasterMetrics;
    for (const k of METRIC_KEYS) m[k] = mix(rm[k], um[k], bm[k], s);
    // F2.8/F3.3: insets S·mix; baseline S·mix + K·(S − 1)·X; cap height (and X) unscaled.
    metrics = {
      referencePointSize: m.referencePointSize,
      baselineOffset: S * m.baselineOffset + BASELINE_K * (S - 1) * m.referencePointSize,
      capHeight: m.capHeight,
      leftInset: S * m.leftInset,
      rightInset: S * m.rightInset,
    };
  }
  const point = (key: "rotationAnchor" | "metricCenter"): [number, number] | undefined => {
    const r = R[key];
    const u = s.ul !== 0 ? ul[key] : r;
    const bb = s.b !== 0 ? b[key] : r;
    if (r === undefined || u === undefined || bb === undefined) return undefined;
    return mixArray(r, u, bb, s);
  };
  const rotationAnchor = point("rotationAnchor");
  const metricCentre = point("metricCenter");
  return {
    args: mixArray(R.args, ul.args, b.args, s),
    viewBox: mixArray(R.viewBox, ul.viewBox, b.viewBox, s).map((v) => S * v) as ViewBox,
    transform: mixArray(R.transform, ul.transform, b.transform, s).map((v) => S * v) as Transform,
    ...(metrics !== undefined ? { metrics } : {}),
    ...(rotationAnchor !== undefined ? { rotationAnchor } : {}),
    ...(metricCentre !== undefined ? { metricCenter: metricCentre } : {}),
    approximate: masterMissing,
    masterMissing,
  };
}
