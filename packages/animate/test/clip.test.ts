import { describe, expect, it } from "vitest";
import { serializePath } from "@opensymbols/core";
import { clipOutline, strokeLength, type StrokeKeyframe } from "../src/index.js";

// ---- helpers -------------------------------------------------------------------------------

const f = Math.fround;

/** `"M0 0 L95 0 …"` → `{ops, argCounts, args}` (absolute letters, as the generator stores them). */
function path(d: string) {
  const ops: string[] = [];
  const argCounts: number[] = [];
  const args: number[] = [];
  for (const m of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
    const nums = m[2]!.trim() ? m[2]!.trim().split(/[\s,]+/).map(Number) : [];
    ops.push(m[1]!);
    argCounts.push(nums.length);
    args.push(...nums);
  }
  return { ops: ops.join(""), argCounts, args };
}

/** Parse an output `d` into commands. */
function commands(d: string): Array<{ op: string; n: number[] }> {
  return [...d.matchAll(/([MLCZ])([^MLCZ]*)/g)].map((m) => ({
    op: m[1]!,
    n: m[2]!.trim() ? m[2]!.trim().split(/\s+/).map(Number) : [],
  }));
}

/** `d` equals `expected` command by command, numbers within `tol` (08 §12: 1e-3 where printed at 3 decimals). */
function expectPath(d: string, expected: string, tol = 1e-3) {
  const a = commands(d);
  const b = commands(expected.replace(/\s+/g, " "));
  expect(a.map((c) => c.op).join("")).toBe(b.map((c) => c.op).join(""));
  a.forEach((c, i) => {
    expect(c.n.length).toBe(b[i]!.n.length);
    c.n.forEach((v, k) => expect(Math.abs(v - b[i]!.n[k]!)).toBeLessThanOrEqual(tol));
  });
}

function clip(p: ReturnType<typeof path>, kf: StrokeKeyframe[], lo: number, hi: number) {
  return clipOutline(p.ops, p.argCounts, p.args, [0, p.ops.length], kf, lo, hi);
}

const kf = (flags: number, progress: number, d0: number, d1: number): StrokeKeyframe => ({ flags, progress, d0, d1 });

// ---- 08 §12.1 a straight stroke --------------------------------------------------------------

describe("08 §12.1: the 95 × 5 bar", () => {
  const bar = path("M0 0 L95 0 L95 5 L0 5 Z");
  const K = [kf(0, 0, 0, 0.975), kf(0, 1, 0.475, 0.5)];

  it("stroke length: the speed v = 95 (the centreline)", () => {
    expect(strokeLength(bar, K)).toBeCloseTo(95, 9);
  });

  it("Draw On at 0.5: the left half with a half-disc cap bulging toward +x", () => {
    expectPath(
      clip(bar, K, 0, 0.5),
      `M 47.5 5 L 0 5 L 0 0 L 47.5 0
       C 48.880712 0  50 1.119288  50 2.5
       C 50 3.880712  48.880712 5  47.5 5 Z`,
    );
  });

  it("numbers are written like core's serializePath (3 decimals, no space after the letter)", () => {
    expect(clip(bar, K, 0, 0.5)).toBe("M47.5 5L0 5L0 0L47.5 0C48.881 0 50 1.119 50 2.5C50 3.881 48.881 5 47.5 5Z");
  });

  it("Draw Off at 0.5: the right half, cap bulging toward −x", () => {
    expectPath(
      clip(bar, K, 0.5, 1),
      `M 47.5 0 L 95 0 L 95 5 L 47.5 5
       C 46.119288 5  45 3.880712  45 2.5
       C 45 1.119288  46.119288 0  47.5 0 Z`,
    );
  });

  it("edges: [0, 1] is the path unchanged; [0, 0] is empty; so are hi ≤ lo and lo ≥ 1", () => {
    expect(clip(bar, K, 0, 1)).toBe(serializePath(bar.ops, bar.argCounts, bar.args, [0, 5]));
    expect(clip(bar, K, 0, 0)).toBe("");
    expect(clip(bar, K, 0.6, 0.4)).toBe("");
    expect(clip(bar, K, 1, 1)).toBe("");
  });

  it("[0, 1e-5]: hi cuts at s = 0.00095 and 194.99905, the left edge and a sliver of each long edge, capped", () => {
    expectPath(
      clip(bar, K, 0, 1e-5),
      `M 0.00095 5 L 0 5 L 0 0 L 0.00095 0
       C 1.381662 0  2.50095 1.119288  2.50095 2.5
       C 2.50095 3.880712  1.381662 5  0.00095 5 Z`,
    );
  });

  it("the Off plateau [0.99989998, 1] (07 §2.8) still cuts: a sliver at the right end", () => {
    const d = clip(bar, K, f(0.9999), 1);
    expect(commands(d).map((c) => c.op).join("")).toBe("MLLLCCZ");
  });

  it("overshoot (08 §7.3): stroke-end 1.08 extends the tip by v · 0.08 = 7.6 past the last keyframe", () => {
    const x = f(1.08) - 1;
    const e = 95 + 95 * x;
    expectPath(
      clip(bar, K, 0, f(1.08)),
      `M 95 5 L 0 5 L 0 0 L 95 0 L ${e} 0
       C ${e + 1.380712} 0  ${e + 2.5} 1.119288  ${e + 2.5} 2.5
       C ${e + 2.5} 3.880712  ${e + 1.380712} 5  ${e} 5 L 95 5 Z`,
    );
  });

  it("a subpath without records is replayed whole, from its original curves", () => {
    const two = path("M0 0 L95 0 L95 5 L0 5 Z M200 0 L210 0 L210 10 Z");
    const d = clip(two, K, 0, 0.5);
    expect(d.endsWith("M200 0L210 0L210 10Z")).toBe(true);
    // An empty range drops everything, un-keyframed subpaths included (08 §6.1).
    expect(clip(two, K, 0, 0)).toBe("");
  });
});

// ---- 08 §12.2 a curve ------------------------------------------------------------------------

describe("08 §12.2: the quarter ring", () => {
  const ring = path("M60 0 C60 33.137085 33.137085 60 0 60 L0 40 C22.091390 40 40 22.091390 40 0 Z");
  const K = [kf(0, 0, 0, 0.8985295), kf(0, 1, 0.4782354, 0.5797059)];

  it("speed v = (Lo + Li) / 2 = 78.55083", () => {
    expect(strokeLength(ring, K)).toBeCloseTo(78.55083, 3);
  });

  it("Draw On at 0.5: E, P, A within 1e-3; one subpath; the cap is two cubics", () => {
    const c = commands(clip(ring, K, 0, 0.5));
    expect(c.map((x) => x.op).join("")).toBe("MCLCCCZ");
    const M = c[0]!.n;
    // P, the entry on the inner arc, is where the outline starts and ends.
    expect(M[0]).toBeCloseTo(28.284271, 3);
    expect(M[1]).toBeCloseTo(28.284271, 3);
    // The outer arc's first half ends at E.
    const outer = c[3]!.n;
    expect(outer[4]).toBeCloseTo(42.426407, 3);
    expect(outer[5]).toBeCloseTo(42.426407, 3);
    // The first cap cubic ends at the apex A; the second at P.
    const cap1 = c[4]!.n;
    expect(cap1[4]).toBeCloseTo(28.284271, 3);
    expect(cap1[5]).toBeCloseTo(42.426407, 3);
    const cap2 = c[5]!.n;
    expect(cap2[4]).toBeCloseTo(28.284271, 3);
    expect(cap2[5]).toBeCloseTo(28.284271, 3);
    // The inner arc's second half ends at (40, 0); the closing edge reaches (60, 0).
    expect(c[1]!.n.slice(4)).toEqual([40, 0]);
    expect(c[2]!.n).toEqual([60, 0]);
  });
});

// ---- 08 §4, §7.4, §8, §9 --------------------------------------------------------------------

describe("08 §4: two subpaths joined at a compound seam", () => {
  // An outer square and an inner one, reversed; the seam joins (0, 0) to (10, 10).
  const sq = path("M0 0 L100 0 L100 100 L0 100 Z M10 10 L10 90 L90 90 L90 10 Z");
  const K = [kf(0, 0, 0, 1), kf(0, 1, 0.5, 1.5)];

  it("one contour slit at the seam; Draw On at 0.5 cuts it once, capped (squared toward E's direction)", () => {
    expectPath(
      clip(sq, K, 0, 0.5),
      `M 90 10 L 10 10 L 0 0 L 100 0
       C 102.761424 0  105 2.238576  105 5
       C 105 7.761424  102.761424 10  100 10 L 90 10 Z`,
    );
  });

  it("the stroke length is the joined contour's speed", () => {
    // 0 → 200 on the outer loop, 160 back on the inner one: (200 + 160) / 2.
    expect(strokeLength(sq, K)).toBeCloseTo(180, 9);
  });
});

describe("08 §8: a bisection record — each half grows away from the chord", () => {
  const bar = path("M0 0 L95 0 L95 5 L0 5 Z");
  // Progress 0 across the middle (flag 8), progress 1 at both ends.
  const K = [kf(8, 0, 47.5 / 200, 147.5 / 200), kf(0, 1, 0, 0.975), kf(0, 1, 0.475, 0.5)];

  it("Draw On at 0.5: two subpaths, x ∈ [23.75, 47.5] and [47.5, 71.25] before their caps", () => {
    const d = clip(bar, K, 0, 0.5);
    const subs = d.split("M").filter(Boolean);
    expect(subs.length).toBe(2);
    const xs = (s: string) =>
      commands(`M${s}`)
        .filter((c) => c.op !== "C")
        .flatMap((c) => c.n.filter((_, i) => i % 2 === 0));
    const a = xs(subs[0]!);
    const b = xs(subs[1]!);
    const [lo, hi] = Math.min(...a) < Math.min(...b) ? [a, b] : [b, a];
    expect(Math.min(...lo)).toBeCloseTo(23.75, 6);
    expect(Math.max(...lo)).toBeCloseTo(47.5, 6);
    expect(Math.min(...hi)).toBeCloseTo(47.5, 6);
    expect(Math.max(...hi)).toBeCloseTo(71.25, 6);
  });

  it("Draw On at 1 is the whole path; at 0 nothing", () => {
    expect(clip(bar, K, 0, 1)).toBe(serializePath(bar.ops, bar.argCounts, bar.args, [0, 5]));
    expect(clip(bar, K, 0, 0)).toBe("");
  });
});

describe("08 §9: a corner record splits the outline round a sharp turn", () => {
  // An L-shaped stroke 10 thick: right along y = 0, then down x = 100. Outer vertex (105, −5).
  const ell = path("M0 -5 L105 -5 L105 100 L95 100 L95 5 L0 5 Z");
  const L = 420;
  const K = [kf(0, 0, 0, 410 / L), kf(1, 0.5, 100 / L, 110 / L), kf(0, 1, 210 / L, 220 / L)];

  it("hi past the corner: the arriving leg whole (sharp vertex included), the other leg growing out of it", () => {
    const d = clip(ell, K, 0, 0.7);
    const subs = d.split("M").filter(Boolean);
    expect(subs.length).toBe(2);
    expect(subs[0]).toContain("105 -5");
    expect(subs[0]!.includes("C")).toBe(false);
    // The second leg reaches y = 40 (0.7 of the way from 0.5 to 1 along x = 105), then its cap.
    expect(subs[1]).toContain("105 40");
  });

  it("a degenerate second piece (vb at a): the remainder after piece 1, no segment drawn twice", () => {
    // Record 2's partner sits at the corner's own point a (s = 100), so cut_range(a, vb) is empty.
    const K2 = [kf(0, 0, 0, 410 / L), kf(1, 0.5, 100 / L, 110 / L), kf(0, 1, 210 / L, 100 / L)];
    const d = clip(ell, K2, 0, 0.7);
    const subs = d.split("M").filter(Boolean);
    expect(subs.length).toBe(2);
    // The outer vertex belongs to piece 1 only; the remainder runs from b (105, 0) to va (0, 5).
    expect(d.split("105 -5").length - 1).toBe(1);
    expect(d.split("95 100").length - 1).toBe(1);
    expect(subs[1]!.startsWith("105 0")).toBe(true);
  });

  it("hi before the corner: only the arriving leg, cut", () => {
    const d = clip(ell, K, 0, 0.3);
    expect(d.split("M").filter(Boolean).length).toBe(1);
    expect(d).toContain("60 -5");
  });
});

describe("08 §7.4: a recorded lineCap replaces the synthetic cap", () => {
  // The bar with a pointed start; the progress-0 record carries flag 2.
  const pointed = path("M0 0 L95 0 L95 5 L0 5 L-2.5 2.5 Z");
  const L = 195 + 2 * Math.hypot(2.5, 2.5);
  const K = [kf(2, 0, 0, 195 / L), kf(0, 1, 95 / L, 100 / L)];

  it("Draw On's tip is capped with the stroke's recorded start shape, turned round", () => {
    expectPath(clip(pointed, K, 0, 0.5), "M 47.5 5 L 0 5 L -2.5 2.5 L 0 0 L 47.5 0 L 50 2.5 L 47.5 5 Z");
  });

  it("Draw Off at 0.5 (lo cut): the start shape as recorded", () => {
    expectPath(clip(pointed, K, 0.5, 1), "M 47.5 0 L 95 0 L 95 5 L 47.5 5 L 45 2.5 L 47.5 0 Z");
  });
});
