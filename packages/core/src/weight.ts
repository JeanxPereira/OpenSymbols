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

/**
 * [INF] The scalars for the six weights between the three stored masters. The decoded table
 * (CoreUI's nine-weight interpolation scalars) is not available: Docs/format/01 section 5.2
 * records that only GlyphWeight 1, 4 and 9 are stored and leaves the scalars open ([OBS]).
 * The formula `p = R + s_ul*(UL - R) + s_b*(B - R)` is CoreUI's (its "Incompatible points when
 * attempting to interpolate: Ultralight, Regular" check); the scalars here are linear in the
 * weight step on each side of Regular, so the result is exact at 1, 4 and 9 and approximate
 * elsewhere.
 */
export function weightScalars(w: number): { ul: number; b: number } {
  return w <= 4 ? { ul: (4 - w) / 3, b: 0 } : { ul: 0, b: (w - 4) / 5 };
}

export interface Interpolated {
  args: number[];
  viewBox: ViewBox;
  transform: Transform;
  /** Undefined when a master the weight draws from has no metrics. */
  metrics?: MasterMetrics;
  /** Not exact: a weight between the masters, or one whose master is not stored. */
  approximate: boolean;
  /** The weight leans toward ultralight or black and that master is not stored (it degrades to regular). */
  masterMissing: boolean;
}

type Scalars = { ul: number; b: number };

const mix = (r: number, ul: number, b: number, s: Scalars): number => r + s.ul * (ul - r) + s.b * (b - r);

function mixArray<T extends number[]>(r: T, ul: T, b: T, s: Scalars): T {
  return r.map((v, i) => mix(v, ul[i] ?? v, b[i] ?? v, s)) as T;
}

const METRIC_KEYS = ["referencePointSize", "baselineOffset", "capHeight", "leftInset", "rightInset"] as const;

/** The variant's shape at weight `w`: the same scalars applied to args, viewBox, transform and metrics. */
export function interpolate(variant: VariantData, w: Weight): Interpolated {
  const wv = weightValue(w);
  const R = variant.masters[4];
  if (!R) throw new TypeError("variant has no regular master (4): generated data is malformed");
  const UL = variant.masters[1];
  const B = variant.masters[9];
  const masterMissing = (wv < 4 && UL === undefined) || (wv > 4 && B === undefined);
  const exact = wv === 4 || (wv === 1 && UL !== undefined) || (wv === 9 && B !== undefined);

  const s = weightScalars(wv);
  // A missing master on the side being interpolated toward degrades to regular.
  const ul: MasterData = UL ?? R;
  const b: MasterData = B ?? R;
  // Metrics only when every master given a non-zero scalar (and regular) has them.
  const rm = R.metrics;
  const um = s.ul > 0 ? ul.metrics : rm;
  const bm = s.b > 0 ? b.metrics : rm;
  let metrics: MasterMetrics | undefined;
  if (rm !== undefined && um !== undefined && bm !== undefined) {
    metrics = {} as MasterMetrics;
    for (const k of METRIC_KEYS) metrics[k] = mix(rm[k], um[k], bm[k], s);
  }
  return {
    args: mixArray(R.args, ul.args, b.args, s),
    viewBox: mixArray(R.viewBox, ul.viewBox, b.viewBox, s),
    transform: mixArray(R.transform, ul.transform, b.transform, s),
    ...(metrics !== undefined ? { metrics } : {}),
    approximate: !exact,
    masterMissing,
  };
}
