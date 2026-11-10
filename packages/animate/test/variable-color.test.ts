import { describe, expect, it } from "vitest";
import { interpolate, type LayerData, type RenderMode, type Role, type VariantData } from "@opensymbols/core";
import { defaultSpec, duration, evalTrack, FILTER, LAYER_FLAG, loopStart, sample, toAnimDrawing, type AnimDrawing, type Spec, type Track } from "../src/index.js";
import { cycleEnds, registerPlan, sampleStopped, stopAt } from "../src/sample.js";
import {
  vcCumulative,
  vcCycle,
  vcInactiveAlpha,
  vcIterative,
  vcIterativeReversing,
  vcWave,
} from "../src/effects/variable-color.js";

// ---- fixture -------------------------------------------------------------------------------

const f = Math.fround;
const A = f(0.3); // 07 §9.5 inactive alpha, dim, not hierarchical
const T3 = f(1 / 3);
const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

/** One square per layer, each with the given threshold (undefined: none). */
function vcDrawing(thresholds: Array<number | undefined>, vcContinuous = false, roles: Role[] = []): AnimDrawing {
  const n = thresholds.length;
  const layers: LayerData[] = thresholds.map((theta, i) => {
    const l: LayerData = {
      cmd: [i * 5, i * 5 + 5],
      role: roles[i] ?? "primary",
      modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: false }])) as LayerData["modes"],
      motionGroup: 10 * (n - i), // descending ids: the motion groups must not matter
      anim: {},
    };
    if (theta !== undefined) l.variableThreshold = theta;
    return l;
  });
  const v: VariantData = {
    ops: "MLLLZ".repeat(n),
    argCounts: thresholds.flatMap(() => [2, 2, 2, 2, 0]),
    masters: { 4: { args: thresholds.flatMap(() => [0, 0, 100, 0, 100, 100, 0, 100]), viewBox: [0, 0, 20, 20], transform: [0.1, 0, 0, 0.1, 0, 0] } },
    layers,
    variableValueMode: "color",
    vcContinuous,
    anim: {},
  };
  return toAnimDrawing(v, interpolate(v, 4));
}

/** `n` layers with ascending thresholds: layer `k − 1` has rank `k`. */
const ladder = (n: number, vcContinuous = false) => vcDrawing(Array.from({ length: n }, (_, i) => (i + 1) / (n + 1)), vcContinuous);

const spec = (over: Partial<Spec> = {}): Spec => ({ ...defaultSpec("variableColor"), ...over });

const alphas = (d: AnimDrawing, s: Spec, t: number) => sample(d, s, t).map((x) => x.alpha);

/** `[rank, absolute time, value]`; "a" is the inactive alpha. */
type Point = [number, number, number | "a"];

function expectPoints(d: AnimDrawing, s: Spec, points: Point[], a = A) {
  for (const [k, t, v] of points) {
    const got = alphas(d, s, t)[k - 1]!;
    const want = v === "a" ? a : v;
    expect(Math.abs(got - want), `rank ${k} at ${t}: ${got} vs ${want}`).toBeLessThanOrEqual(1e-4);
  }
}

/** A track's value pairs `[start + Σd, value]` (loop-phase times). */
const knots = (tr: Track): Array<[number, number]> => {
  const out: Array<[number, number]> = [[tr.start, tr.from]];
  let t = tr.start;
  for (const s of tr.segments) out.push([(t += s.duration), s.to]);
  return out;
};

const near = (x: number, y: number, tol: number) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThanOrEqual(tol);

// ---- the threshold rank (07 §9.5) ----------------------------------------------------------

describe("threshold rank", () => {
  it("dense 1-based rank of the threshold, ascending; ties share; none (or non-finite) is −1", () => {
    const d = vcDrawing([0.5, 0.2, undefined, 0.5, 0.9, 0.2, Infinity]);
    expect(d.layers.map((l) => l.rank)).toEqual([2, 1, -1, 2, 3, 1, -1]);
    expect(d.rankCount).toBe(3);
    expect(d.layers.map((l) => (l.flags & LAYER_FLAG.hasThreshold) !== 0)).toEqual([true, true, false, true, true, true, false]);
    expect(LAYER_FLAG.hasThreshold).toBe(0x20);
  });

  it("a drawing without thresholds has rankCount 0", () => {
    const d = vcDrawing([undefined, undefined]);
    expect(d.rankCount).toBe(0);
    expect(d.layers.every((l) => l.rank === -1 && (l.flags & 0x20) === 0)).toBe(true);
  });

  it("equal thresholds animate together (index mode 3)", () => {
    const d = vcDrawing([0.2, 0.5, 0.2]);
    const s = spec({ repeat: "continuous" });
    for (let t = 0; t < 4; t += 0.05) {
      const st = alphas(d, s, t);
      expect(st[0]).toBe(st[2]);
    }
  });
});

// ---- durations (07 §5 local_duration, kind 1) ----------------------------------------------

describe("local_duration (07 §9.5)", () => {
  const clamp = (n: number) => Math.min(Math.max(n, 1), 3);
  const tail = (n: number) => n / 9 / (n / 12 + 1 / 3 + (2 * n - 8) / 60);
  const table: Array<[string, Spec["vcFill"], boolean, boolean, (n: number) => number, number]> = [
    ["cumulative", "cumulative", false, false, (n) => clamp(n) / 3 + 2 / 3, 1 / 3],
    ["cumulative, vcContinuous", "cumulative", false, true, (n) => clamp(n) / 3 + 2 / 3, 1 / 3],
    ["cumulative reversing", "cumulative", true, false, (n) => (clamp(n) * 2) / 3 + 1 / 3, 1 / 3],
    ["iterative", "iterative", false, false, (n) => (clamp(n) + 1) / 3, 1 / 3],
    // the wave; n = 0 falls back to iterative's n = 0 form with the wave's gap 0 [INF]
    ["iterative, vcContinuous (wave)", "iterative", false, true, (n) => (n === 0 ? 2 / 3 : n <= 3 ? n / 3 : tail(n)), 0],
    ["iterative reversing", "iterative", true, false, (n) => (n < 3 ? 2 / 3 : n === 3 ? 4 / 3 : 2.5), 0],
    ["iterative reversing, vcContinuous", "iterative", true, true, (n) => (n + 1 < 3 ? 2 / 3 : n + 1 === 3 ? 4 / 3 : 2.5), 0],
  ];
  for (const [name, fill, rev, cont, want, gap] of table) {
    it(`${name}: n = 0 … 8`, () => {
      for (let n = 0; n <= 8; n++) {
        const c = vcCycle(n, fill, rev, cont, A);
        near(c.duration, want(n), 1e-6);
        near(c.gap, gap, 1e-6);
        // Every value is the end of the builder's last track (07 §9.5).
        let end = 0;
        for (const tr of c.tracks) end = Math.max(end, knots(tr).at(-1)![0]);
        if (!(cont && fill === "iterative" && !rev && n >= 1)) near(end, c.duration, 1e-6);
      }
    });
  }

  it("continuous duration() is D + gap; once is intro + D + gap + outro (+ the largest wave delay)", () => {
    for (let n = 0; n <= 8; n++) {
      for (const [fill, rev] of [["cumulative", false], ["cumulative", true], ["iterative", false], ["iterative", true]] as const) {
        for (const cont of [false, true]) {
          const d = ladder(n, cont);
          const c = vcCycle(n, fill, rev, cont, A);
          const base = { vcFill: fill, vcReversing: rev };
          near(duration(d, spec({ ...base, repeat: "continuous" })), c.duration + c.gap, 1e-6);
          const delay = c.delay ? Math.max(...c.delay) : 0;
          // The gap is wall-clock seconds (07 §6.2 step 5): only the intro, delay, cycle and outro scale.
          near(duration(d, spec({ ...base, repeat: "once", speed: 2 })), (T3 + delay + c.duration + T3) / 2 + c.gap, 1e-6);
          expect(loopStart(d, spec({ ...base, repeat: "once" }))).toBe(0);
          expect(cycleEnds(d, spec({ ...base, repeat: "once" }), 1)).toBeUndefined();
          expect(stopAt(d, spec({ ...base, repeat: "once" }), 1)).toBeUndefined();
        }
      }
    }
  });
});

// ---- the closed forms against the timelines (07 §9.5; n = 3 and n = 6) --------------------

describe("cumulative (style 0)", () => {
  const s = spec({ repeat: "continuous" });
  it("n = 3: lit ascending every 1/3, all fade together 1.6667 → 2.0", () => {
    expectPoints(ladder(3), s, [
      [1, 0.3333, "a"], [1, 0.6667, 1], [1, 1.6667, 1], [1, 2.0, "a"],
      [2, 0.6667, "a"], [2, 1.0, 1], [2, 1.6667, 1], [2, 2.0, "a"],
      [3, 1.0, "a"], [3, 1.3333, 1], [3, 1.6667, 1], [3, 2.0, "a"],
    ]);
  });
  it("n = 6: step 0.1333; all fade 1.6667 → 2.0", () => {
    const starts = [0.3333, 0.4667, 0.6, 0.7333, 0.8667, 1.0];
    expectPoints(ladder(6), s, starts.flatMap((t, i): Point[] => [[i + 1, t, "a"], [i + 1, t + 1 / 3, 1], [i + 1, 1.6667, 1], [i + 1, 2.0, "a"]]));
    const c = vcCumulative(6, A);
    c.tracks.forEach((tr, i) => near(tr.start, (i * 2) / 15, 1e-6));
  });
});

describe("cumulative reversing (style 1)", () => {
  const s = spec({ repeat: "continuous", vcReversing: true });
  it("n = 3: lit ascending, faded descending; ends 2.6667", () => {
    expectPoints(ladder(3), s, [
      [1, 0.3333, "a"], [1, 0.6667, 1], [1, 2.3333, 1], [1, 2.6667, "a"],
      [2, 0.6667, "a"], [2, 1.0, 1], [2, 2.0, 1], [2, 2.3333, "a"],
      [3, 1.0, "a"], [3, 1.3333, 1], [3, 1.6667, 1], [3, 2.0, "a"],
    ]);
  });
  it("n = 6: fade-out starts k6 1.6667 … k1 2.3333", () => {
    const starts = [0.3333, 0.4667, 0.6, 0.7333, 0.8667, 1.0];
    const fades = [2.3333, 2.2, 2.0667, 1.9333, 1.8, 1.6667];
    expectPoints(
      ladder(6),
      s,
      starts.flatMap((t, i): Point[] => [[i + 1, t, "a"], [i + 1, t + 1 / 3, 1], [i + 1, fades[i]!, 1], [i + 1, fades[i]! + 1 / 3, "a"]]),
    );
  });
});

describe("iterative (style 2)", () => {
  const s = spec({ repeat: "continuous", vcFill: "iterative" });
  it("n = 3: step, rise and decay 1/3", () => {
    expectPoints(ladder(3), s, [
      [1, 0.3333, "a"], [1, 0.6667, 1], [1, 1.0, "a"],
      [2, 0.6667, "a"], [2, 1.0, 1], [2, 1.3333, "a"],
      [3, 1.0, "a"], [3, 1.3333, 1], [3, 1.6667, "a"],
    ]);
  });
  it("n = 6: r = 0.123457, f = 0.592593", () => {
    const r = 0.123457;
    const fall = 0.592593;
    const c = vcIterative(6, false, A);
    near(c.tracks[0]!.segments[0]!.duration, r, 1e-6);
    near(c.tracks[0]!.segments[1]!.duration, fall, 1e-6);
    expectPoints(
      ladder(6),
      s,
      Array.from({ length: 6 }, (_, i): Point[] => {
        const t = 0.33333 + i * r;
        return [[i + 1, t, "a"], [i + 1, t + r, 1], [i + 1, t + r + fall, "a"]];
      }).flat(),
    );
    near(1 / 3 + 5 * r + r + fall, 1.6667, 1e-4); // k6 ends at 1.6667
  });

  it("the +1 (bit 28 with a repeat delay), n = 3: N = 4, the wrap is variable-alpha-max on rank 1", () => {
    const c = vcIterative(3, true, A);
    expect(c.tracks.map((t) => [t.property, t.rank])).toEqual([
      ["variableAlpha", 1],
      ["variableAlpha", 2],
      ["variableAlpha", 3],
      ["variableAlphaMax", 1],
    ]);
    const want = [[0.3333, 0.5, 1.1667], [0.5, 0.6667, 1.3333], [0.6667, 0.8333, 1.5], [0.8333, 1.0, 1.6667]];
    c.tracks.forEach((tr, i) => knots(tr).forEach(([t], j) => near(t + 1 / 3, want[i]![j]!, 1e-4)));
    near(c.duration, 4 / 3, 1e-6);
  });

  it("the +1, n = 6: N = 7, r = 0.109290, f = 0.568306; the wrap on k1 0.9891 → 1.0984 → 1.6667", () => {
    const c = vcIterative(6, true, A);
    expect(c.tracks).toHaveLength(7);
    near(c.tracks[0]!.segments[0]!.duration, 0.10929, 1e-6);
    near(c.tracks[0]!.segments[1]!.duration, 0.568306, 1e-6);
    const at = (i: number) => knots(c.tracks[i]!).map(([t]) => t + 1 / 3);
    at(0).forEach((t, j) => near(t, [0.3333, 0.4426, 1.0109][j]!, 1e-4));
    at(5).forEach((t, j) => near(t, [0.8798, 0.9891, 1.5574][j]!, 1e-4));
    at(6).forEach((t, j) => near(t, [0.9891, 1.0984, 1.6667][j]!, 1e-4));
    expect(c.tracks[6]!.property).toBe("variableAlphaMax");
    expect(c.tracks[6]!.rank).toBe(1);
    // max: while the wrap rises, rank 1 follows it up from its own decay
    const k1 = evalTrack(c.tracks[0]!, 1.0984 - 1 / 3);
    const wrap = evalTrack(c.tracks[6]!, 1.0984 - 1 / 3);
    expect(wrap).toBeGreaterThan(k1);
  });
});

describe("the wave (iterative + vcContinuous, option bit 6)", () => {
  const s = spec({ repeat: "continuous", vcFill: "iterative" });
  it("n = 3: rank k delayed k/3 after the intro; period 1.0 per rank", () => {
    const d = ladder(3, true);
    expectPoints(d, s, [
      [1, 0.6667, "a"], [1, 1.0, 1], [1, 1.3333, "a"],
      [2, 1.0, "a"], [2, 1.3333, 1], [2, 1.6667, "a"],
      [3, 1.3333, "a"], [3, 1.6667, 1], [3, 2.0, "a"],
      // repeating every 1.0 s per rank
      [1, 2.0, 1], [2, 2.3333, 1], [3, 2.6667, 1],
      // waiting for its delay, a rank holds the intro's end
      [3, 0.5, "a"], [3, 1.0, "a"],
    ]);
    expect(duration(d, s)).toBeCloseTo(1, 6);
    expect(loopStart(d, s)).toBeCloseTo(1 / 3 + 1, 6);
  });

  it("n = 6: period 0.740741, delay k·0.123457", () => {
    const d = ladder(6, true);
    const c = vcWave(6, A);
    near(c.duration, 0.740741, 1e-6);
    near(c.delay[1]!, 0.123457, 1e-6);
    c.delay.forEach((x, k) => near(x, (k * 10) / 81, 1e-6));
    const r = 0.123457;
    expectPoints(
      d,
      s,
      Array.from({ length: 6 }, (_, i): Point[] => {
        const t = 0.33333 + (i + 1) * r;
        return [[i + 1, t, "a"], [i + 1, t + r, 1], [i + 1, t + r + 0.592593, "a"], [i + 1, t + 0.740741 + r, 1]];
      }).flat(),
    );
    expectPoints(d, s, [[1, 0.5802, 1], [2, 0.7037, 1], [6, 1.1975, 1], [6, 1.7901, "a"]]);
  });

  it("the ranks run on per-rank clocks: rank k is rank 1 shifted by (k − 1)·r", () => {
    const d = ladder(5, true);
    const r = vcWave(5, A).delay[1]!;
    for (let t = 1.5; t < 4; t += 0.0731) {
      const now = alphas(d, s, t);
      for (let k = 2; k <= 5; k++) expect(now[k - 1]).toBeCloseTo(alphas(d, s, t - (k - 1) * r)[0]!, 9);
    }
  });

  it("n = 1 and n = 4: the list outlasts the period, so each cycle cuts its decay", () => {
    for (const n of [1, 4]) {
      const c = vcWave(n, A);
      const tr = c.tracks[0]!;
      expect(knots(tr).at(-1)![0]).toBeGreaterThan(c.duration);
    }
  });
});

describe("iterative reversing (style 3)", () => {
  const s = spec({ repeat: "continuous", vcFill: "iterative", vcReversing: true });
  it("n = 3: peaks at 0 (k1), 1/3 (k2), 2/3 (k3), 1 (k2), 4/3 (k1)", () => {
    expectPoints(ladder(3), s, [
      [1, 0.3334, 1], [1, 0.6667, "a"], [1, 1.3333, "a"], [1, 1.6667, 1],
      [2, 0.3334, "a"], [2, 0.6667, 1], [2, 1.0, "a"], [2, 1.3333, 1], [2, 1.6666, "a"],
      [3, 0.6667, "a"], [3, 1.0, 1], [3, 1.3333, "a"],
    ]);
  });
  it("n = 6: s = 0.142045, F = 0.681818, h = 0.284091; cycle 2.5", () => {
    const c = vcIterativeReversing(6, false, A);
    near(c.tracks[1]!.segments[0]!.duration, 0.142045, 1e-6);
    near(c.tracks[1]!.segments[1]!.duration, 0.681818, 1e-6);
    near(c.tracks[0]!.segments[1]!.duration, 4 * 0.284091, 1e-6);
    expectPoints(ladder(6), s, [
      [1, 0.3334, 1], [1, 1.0152, "a"], [1, 2.1515, "a"], [1, 2.2936, 1],
      [2, 0.3334, "a"], [2, 0.4754, 1], [2, 1.1572, "a"], [2, 2.0095, "a"], [2, 2.1515, 1], [2, 2.8332, "a"],
      [3, 0.4754, "a"], [3, 0.6174, 1], [3, 1.2992, "a"], [3, 1.8674, "a"], [3, 2.0095, 1], [3, 2.6913, "a"],
      [4, 0.6174, "a"], [4, 0.7595, 1], [4, 1.4413, "a"], [4, 1.7254, "a"], [4, 1.8674, 1], [4, 2.5492, "a"],
      [5, 0.7595, "a"], [5, 0.9015, 1], [5, 1.5833, "a"], [5, 1.7254, 1], [5, 2.4072, "a"],
      [6, 0.9015, "a"], [6, 1.0436, 1], [6, 1.5833, 1], [6, 2.2652, "a"],
    ]);
  });
  it("with vcContinuous the last header is the wrap (N = n + 1)", () => {
    const c = vcIterativeReversing(3, true, A);
    expect(c.tracks).toHaveLength(4);
    expect([c.tracks[3]!.property, c.tracks[3]!.rank]).toEqual(["variableAlphaMax", 1]);
    near(c.duration, 2.5, 1e-6);
  });
});

// ---- n = 0 -------------------------------------------------------------------------------

describe("n = 0 (no threshold)", () => {
  const d = vcDrawing([undefined, undefined]);
  it("cumulative: `alpha` on every layer, a → 1 → 1 → a over 1.0", () => {
    const s = spec({ repeat: "continuous" });
    expectPoints(d, s, [[1, 0.3334, "a"], [2, 0.6667, 1], [1, 1.0, 1], [2, 1.3333, "a"]]);
  });
  it("iterative: `alpha`, a → 1 → a over 2/3; with vcContinuous the same, gap 0 [INF]", () => {
    expectPoints(d, spec({ repeat: "continuous", vcFill: "iterative" }), [[1, 0.3334, "a"], [1, 0.6667, 1], [1, 1.0, "a"], [1, 1.3333, "a"]]);
    const c = vcDrawing([undefined], true);
    expectPoints(c, spec({ repeat: "continuous", vcFill: "iterative" }), [[1, 0.6667, 1], [1, 1.0, "a"], [1, 1.3333, 1]]);
  });
  it("iterative reversing: `alpha`, 1 → a → 1; with vcContinuous nothing is reached", () => {
    expectPoints(d, spec({ repeat: "continuous", vcFill: "iterative", vcReversing: true }), [[1, 0.3334, 1], [1, 0.6667, "a"], [1, 1.0, 1]]);
    const c = vcDrawing([undefined], true);
    const s = spec({ repeat: "continuous", vcFill: "iterative", vcReversing: true });
    for (let t = 0; t < 3; t += 0.1) expect(alphas(c, s, t)).toEqual([1]);
  });
});

// ---- phases, inactive alpha --------------------------------------------------------------

describe("intro, gap and outro", () => {
  it("once: the intro fades threshold layers 1 → a, one cycle, the gap, the outro back to 1", () => {
    const d = vcDrawing([0.2, undefined, 0.5, 0.8]);
    const s = spec();
    expect(alphas(d, s, 0)).toEqual([1, 1, 1, 1]);
    const mid = alphas(d, s, T3 / 2);
    expect(mid[0]).toBeCloseTo(1 + (A - 1) * 0.5, 6); // c1 is symmetric: 0.5 at the half
    expect(mid[1]).toBe(1);
    near(alphas(d, s, 0.3333)[3]!, A, 1e-4);
    // cycle 5/3 ends at 2.0, the gap holds to 2.3333, the outro returns to 1 at 2.6667
    const total = duration(d, s);
    near(total, 1 / 3 + 5 / 3 + 1 / 3 + 1 / 3, 1e-6);
    expectPoints(d, s, [[1, 2.1, "a"], [3, 2.3, "a"], [4, 2.3, "a"]]);
    expect(alphas(d, s, 2.5)[0]).toBeCloseTo(1 + (A - 1) * 0.5, 6);
    expect(alphas(d, s, total)).toEqual([1, 1, 1, 1]);
    expect(alphas(d, s, total + 5)).toEqual([1, 1, 1, 1]);
    for (let t = 0; t < total + 1; t += 0.05) expect(alphas(d, s, t)[1]).toBe(1);
  });

  it("once, the wave: each rank's outro starts after its own cycle", () => {
    const d = ladder(3, true);
    const s = spec({ vcFill: "iterative" });
    // rank k: intro, waits k/3, cycle 1.0, outro 1/3
    near(duration(d, s), 1 / 3 + 1 + 1 + 1 / 3, 1e-6);
    expect(alphas(d, s, 1 / 3 + 1 / 3 + 1 + 0.5 * T3 - 1e-9)[0]).toBeCloseTo(1 + (A - 1) * 0.5, 5);
    for (const x of alphas(d, s, 1 / 3 + 1 + 1 + T3)) expect(x).toBeCloseTo(1, 9);
  });

  it("hide: a = 0, so inactive layers are invisible", () => {
    const d = ladder(3);
    const s = spec({ vcInactive: "hide", repeat: "continuous" });
    expect(vcInactiveAlpha(s)).toBe(0);
    const st = sample(d, s, 0.34);
    expect(st[2]!.alpha).toBeCloseTo(0, 3);
    expect(sample(d, s, 1.9)[0]!.visible).toBe(true);
    expect(sample(d, s, 2.1)[0]!.visible).toBe(false);
  });

  it("hierarchical: a is the level-2 alpha; monochrome dim: 0.30000001192092896", () => {
    expect(vcInactiveAlpha(spec({ renderingMode: "hierarchical" }))).toBe(0.5);
    expect(vcInactiveAlpha(spec({ renderingMode: "hierarchical", appearance: "dark" }))).toBe(0.5);
    expect(vcInactiveAlpha(spec())).toBe(0.30000001192092896);
    expect(vcInactiveAlpha(spec({ renderingMode: "hierarchical", vcInactive: "hide" }))).toBe(0);
    const d = vcDrawing([0.2, 0.5], false, ["primary", "secondary"]);
    expectPoints(d, spec({ renderingMode: "hierarchical", repeat: "continuous" }), [[2, 0.34, "a"], [1, 2.0, "a"]], 0.5);
  });
});

// ---- continuous: periodicity and stop ----------------------------------------------------

const STYLES: Array<Partial<Spec>> = [
  {},
  { vcReversing: true },
  { vcFill: "iterative" },
  { vcFill: "iterative", vcReversing: true },
];

describe("continuous", () => {
  it("sample(t) == sample(t + duration()) from loopStart on, every style, n = 1, 3, 6, with and without vcContinuous", () => {
    for (const n of [1, 3, 6]) {
      for (const cont of [false, true]) {
        const d = ladder(n, cont);
        for (const st of STYLES) {
          const s = spec({ ...st, repeat: "continuous", speed: 1.3 });
          const p = duration(d, s);
          const t0 = loopStart(d, s);
          // From just after loopStart: iterative reversing jumps a → 1 on layer 1 at the intro's end (07 §9.5).
          for (let t = t0 + 1e-3; t < t0 + 3; t += 0.0617) {
            const x = alphas(d, s, t);
            const y = alphas(d, s, t + p);
            x.forEach((v, i) => expect(Math.abs(v - y[i]!), `n ${n} ${cont} ${JSON.stringify(st)} t ${t} p ${p} layer ${i}: ${v} vs ${y[i]}`).toBeLessThanOrEqual(1e-6));
          }
        }
      }
    }
  });

  it("the repeat gap lasts `gap` wall-clock seconds at any speed (07 §6.2 step 5, period D + speed·gap)", () => {
    const d = ladder(3);
    for (const speed of [2, 0.5]) {
      const D = 5 / 3;
      const gap = 1 / 3;
      // once: intro, cycle and outro scale with speed; the gap does not
      near(duration(d, spec({ speed })), (1 / 3 + D + 1 / 3) / speed + gap, 1e-6);
      const s = spec({ speed, repeat: "continuous" });
      near(duration(d, s), D / speed + gap, 1e-6);
      near(loopStart(d, s), 1 / 3 / speed, 1e-6);
      // the first cycle ends at (1/3 + D)/speed; the gap holds its last values for `gap` seconds
      const cycleEnd = (1 / 3 + D) / speed;
      for (const t of [cycleEnd + 0.01, cycleEnd + gap / 2, cycleEnd + gap - 0.01]) expectPoints(d, s, [[1, t, "a"], [2, t, "a"], [3, t, "a"]]);
      // then rank 1 rises again
      expect(alphas(d, s, cycleEnd + gap + 0.1)[0]!).toBeGreaterThan(A + 0.01);
      // periodic from loopStart on
      const p = duration(d, s);
      for (let t = loopStart(d, s) + 1e-3; t < 6; t += 0.0617) {
        const x = alphas(d, s, t);
        const y = alphas(d, s, t + p);
        x.forEach((v, i) => near(v, y[i]!, 1e-6));
      }
      // stopped in the first cycle: it ends after the gap, then the outro (1/3 effect seconds)
      const halt = stopAt(d, s, cycleEnd - 0.05)!;
      near(cycleEnds(d, s, cycleEnd - 0.05)![0]!, cycleEnd + gap, 1e-6);
      near(halt.end, cycleEnd + gap + 1 / 3 / speed, 1e-6);
      expect(sampleStopped(d, s, halt, halt.end).map((x) => x.alpha)).toEqual([1, 1, 1]);
    }
  });

  it("stop finishes the cycle, then plays the outro, then rests", () => {
    const d = ladder(3);
    const s = spec({ repeat: "continuous" });
    // period 2.0 (5/3 + gap 1/3); stopped at 1.0, the cycle ends at 1/3 + 2.0
    const halt = stopAt(d, s, 1.0)!;
    near(halt.end, 1 / 3 + 2 + 1 / 3, 1e-6);
    expect(sampleStopped(d, s, halt, 1.5)).toEqual(sample(d, s, 1.5));
    near(sampleStopped(d, s, halt, 2.3)[0]!.alpha, A, 1e-4);
    expect(sampleStopped(d, s, halt, 2.3334 + T3 / 2)[0]!.alpha).toBeCloseTo(1 + (A - 1) * 0.5, 3);
    expect(sampleStopped(d, s, halt, halt.end).map((x) => x.alpha)).toEqual([1, 1, 1]);
  });

  it("the wave stopped: each rank finishes its own cycle; a rank still waiting ends at once and plays the outro", () => {
    const d = ladder(3, true);
    const s = spec({ repeat: "continuous", vcFill: "iterative" });
    // at 0.5 every rank waits (rank 1 starts at 2/3)
    const early = stopAt(d, s, 0.5)!;
    near(early.end, 0.5 + T3, 1e-6);
    expect(sampleStopped(d, s, early, 0.5 + T3).map((x) => x.alpha)).toEqual([1, 1, 1]);
    // at 1.2: rank 1 (started 2/3) ends 5/3, rank 2 (started 1.0) ends 2.0, rank 3 waits (starts 4/3)
    const ends = cycleEnds(d, s, 1.2)!;
    near(ends[1]!, 2 / 3 + 1, 1e-6);
    near(ends[2]!, 1 + 1, 1e-6);
    near(ends[3]!, 1.2, 1e-6);
    const halt = stopAt(d, s, 1.2)!;
    near(halt.end, 2 + T3, 1e-6);
    expect(sampleStopped(d, s, halt, halt.end).map((x) => x.alpha)).toEqual([1, 1, 1]);
  });
});

// ---- the static form is unchanged; no NaN ------------------------------------------------

describe("variableValue present: the static form", () => {
  it("ignores the animated options", () => {
    const d = ladder(3);
    const base = alphas(d, spec({ variableValue: 0.5 }), 0);
    expect(base).toEqual([1, 1, A]);
    expect(alphas(d, spec({ variableValue: 0.5, vcFill: "iterative", vcReversing: true, vcInactive: "hide", repeat: "continuous" }), 1.7)).toEqual(base);
  });
});

describe("no NaN", () => {
  it("every state is finite over n = 0 … 8, every style, inactive, mode, repeat and speed", () => {
    const bad: string[] = [];
    for (let n = 0; n <= 8; n++) {
      for (const cont of [false, true]) {
        const d = vcDrawing([...Array.from({ length: n }, (_, i) => i / 8), undefined], cont);
        for (const st of STYLES) {
          for (const vcInactive of ["dim", "hide"] as const) {
            for (const renderingMode of ["monochrome", "hierarchical"] as const) {
              for (const repeat of ["once", "continuous"] as const) {
                const s = spec({ ...st, vcInactive, renderingMode, repeat, speed: n % 2 ? 0.7 : 2.3 });
                const ok = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
                if (!Number.isFinite(duration(d, s)) || !Number.isFinite(loopStart(d, s))) bad.push(`${n} ${JSON.stringify(s)} duration`);
                for (let t = -0.5; t <= 6; t += 0.173) {
                  if (!sample(d, s, t).every((x) => ok(x.alpha))) bad.push(`${n} ${JSON.stringify(s)} t ${t}`);
                }
                if (repeat === "continuous") {
                  const h = stopAt(d, s, 1.1)!;
                  if (!Number.isFinite(h.end)) bad.push(`${n} ${JSON.stringify(s)} stop`);
                  for (let t = 1.1; t <= h.end + 0.2; t += 0.09) {
                    if (!sampleStopped(d, s, h, t).every((x) => ok(x.alpha))) bad.push(`${n} ${JSON.stringify(s)} stopped t ${t}`);
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the variable-alpha properties (07 §2.3 8–10)", () => {
  it("8 assigns, 9 takes the max, 10 fades toward a, in plan order; vAlpha multiplies alpha; rank and hasThreshold admit", () => {
    const d = vcDrawing([0.2, 0.5, undefined]);
    const k = (property: Track["property"], v: number, over: Partial<Track> = {}): Track => ({ property, start: 0, from: v, segments: [], ...over });
    const undo = registerPlan("variableColor", () => ({
      tracks: [
        k("variableAlpha", 0.4, { rank: 1 }),
        k("variableAlphaMax", 0.6, { rank: 1 }),
        k("variableAlpha", 0.2, { rank: 2 }),
        k("variableAlphaMax", 0.1, { rank: 2 }),
        k("variableAlphaFade", 0.5, { filter: FILTER.hasThreshold }),
        k("alpha", 0.5),
      ],
      inactiveAlpha: () => 0,
    }));
    try {
      // rank 1: max(0.4, 0.6) = 0.6, halfway to 0 → 0.3, × 0.5; rank 2: 0.2 → 0.1 → 0.05; none: 0.5
      const st = alphas(d, spec(), 0);
      expect(st[0]).toBeCloseTo(0.15, 12);
      expect(st[1]).toBeCloseTo(0.05, 12);
      expect(st[2]).toBe(0.5);
    } finally {
      undo();
    }
  });
});
