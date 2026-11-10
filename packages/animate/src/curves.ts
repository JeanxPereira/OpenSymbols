/**
 * The 42 timing curves (Docs/format/07 §3). Each is the cubic Bézier (0,0) (x1,y1) (x2,y2) (1,1);
 * its value at `u` is the `y` of the point whose `x` is `u`.
 */

const f = Math.fround;

/** 07 §3.2, `curve_defs`, in order; duplicated rows are duplicated there. float32 (07 §2.8). */
export const CURVE_TABLE: ReadonlyArray<readonly [number, number, number, number]> = (
  [
    [0, 0, 1, 1], // 0
    [0.33, 0, 0.67, 1], // 1
    [0.4, 0, 0.6, 1], // 2
    [0.55, 0, 0.67, 1], // 3
    [0.45, 0, 0.67, 1], // 4
    [0.25, 0, 0.55, 1], // 5
    [0.55, 0, 0.67, 1], // 6
    [0.33, 0, 0.67, 1], // 7
    [0.12, 0.17, 0.67, 1], // 8
    [0.33, 0, 0.88, 0.83], // 9
    [0.25, 0.25, 0.25, 1], // 10
    [0.33, 0, 0.88, 0.83], // 11
    [0.17, 0.17, 0.83, 0.83], // 12
    [0.4, 0.5, 0.8, 1], // 13
    [0.33, 0, 0.67, 1], // 14
    [0.33, 0, 0.2, 1], // 15
    [0.33, 0, 0.8, 0.7], // 16
    [0.2, 0, 0.25, 1], // 17
    [0.4, 0, 0.8, 1], // 18
    [0.75, 0, 0.8, 1], // 19
    [0.2, 0, 0.25, 1], // 20
    [0.33, 0, 0.83, 0.83], // 21
    [0.17, 0.17, 0.67, 1], // 22
    [0.2, 0, 0.25, 1], // 23
    [0.33, 0, 0.67, 1], // 24
    [0.33, 0, 0.67, 1], // 25
    [0.33, 0, 0.67, 1], // 26
    [0.55, 0, 0.67, 1], // 27
    [0.45, 0, 0.67, 1], // 28
    [0.25, 0, 0.55, 1], // 29
    [0.33, 0, 0.67, 1], // 30
    [0.33, 0, 0.2, 1], // 31
    [0.33, 0, 0.67, 1], // 32
    [0.33, 0, 0.8, 0.7], // 33
    [0.33, 0, 0.67, 1], // 34
    [0.75, 0, 0.8, 1], // 35
    [0.2, 0, 0.25, 1], // 36
    [0.55, 0, 0.67, 1], // 37
    [0.45, 0, 0.67, 1], // 38
    [0.25, 0, 0.55, 1], // 39
    [0.35, 0, 0.25, 1], // 40
    [0.75, 0, 0.65, 1], // 41
  ] as const
).map((r) => [f(r[0]), f(r[1]), f(r[2]), f(r[3])] as const);

/** 07 §3.1: 42 entries (`cmp w8,#0x29`). */
export const CURVE_COUNT = CURVE_TABLE.length;

const linear = (u: number): number => clampUnit(u);

/** 07 §3.1 [INF]: `u` clamped to [0, 1]; a non-finite `u` is 0. */
function clampUnit(u: number): number {
  if (!Number.isFinite(u)) return 0;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** One coordinate of the Bézier with end points 0 and 1 and controls `p1`, `p2`, at parameter `s`. */
const coord = (p1: number, p2: number, s: number): number => {
  const m = 1 - s;
  return 3 * m * m * s * p1 + 3 * m * s * s * p2 + s * s * s;
};
const coordDerivative = (p1: number, p2: number, s: number): number => {
  const m = 1 - s;
  return 3 * m * m * p1 + 6 * m * s * (p2 - p1) + 3 * s * s * (1 - p2);
};

const EPS = 1e-12;

function bezierCurve(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  return (raw) => {
    const u = clampUnit(raw);
    if (u === 0 || u === 1) return u;
    // 07 §3.1 [INF]: Newton from s = u, bisection fallback; x is monotone since x1, x2 ∈ [0, 1].
    let s = u;
    for (let i = 0; i < 8; i++) {
      const err = coord(x1, x2, s) - u;
      if (Math.abs(err) < EPS) return coord(y1, y2, s);
      const dx = coordDerivative(x1, x2, s);
      if (Math.abs(dx) < 1e-9) break;
      s -= err / dx;
      if (s < 0 || s > 1) break;
    }
    let lo = 0;
    let hi = 1;
    s = u;
    for (let i = 0; i < 64; i++) {
      const x = coord(x1, x2, s);
      if (Math.abs(x - u) < EPS) break;
      if (x < u) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return coord(y1, y2, s);
  };
}

const CURVES: ReadonlyArray<(u: number) => number> = CURVE_TABLE.map(([x1, y1, x2, y2]) =>
  // 07 §3.1 [INF]: control points on the diagonal (curves 0 and 12, 07 §3.3) are exactly linear.
  x1 === y1 && x2 === y2 ? linear : bezierCurve(x1, y1, x2, y2),
);

/** Curve `id` of 07 §3.2 as `u ↦ y`. An id outside 0..41 (or not an integer) is linear (07 §3.1). */
export function curve(id: number): (u: number) => number {
  return (Number.isInteger(id) ? CURVES[id] : undefined) ?? linear;
}
