import { describe, expect, it } from "vitest";
import { interpolate, type LayerData, type RenderMode, type Role, type VariantData } from "@opensymbols/core";
import {
  defaultSpec,
  duration,
  loopStart,
  sample,
  toAnimDrawing,
  trackEnd,
  type AnimDrawing,
  type EffectKind,
  type LayerState,
  type Spec,
} from "../src/index.js";
import { BUILTIN_PLANS } from "../src/effects/index.js";
import { curve } from "../src/curves.js";

// ---- fixture -------------------------------------------------------------------------------

const f = Math.fround;
const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

interface L {
  group: number;
  role?: Role;
  pulses?: boolean;
  rotates?: boolean;
  eraser?: boolean;
}

const METRIC: [number, number] = [50, 50];
const ANCHOR: [number, number] = [10, 20];

/** One 0..100 square per layer; metric centre (50, 50), rotation anchor (10, 20), point size 20, transform ×0.1. */
function drawing(spec: L[], anim: Record<string, unknown> = {}): AnimDrawing {
  const ops = "MLLLZ".repeat(spec.length);
  const argCounts = spec.flatMap(() => [2, 2, 2, 2, 0]);
  const args = spec.flatMap(() => [0, 0, 100, 0, 100, 100, 0, 100]);
  const layers: LayerData[] = spec.map((l, i) => ({
    cmd: [i * 5, i * 5 + 5],
    role: l.role ?? "primary",
    modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: l.eraser === true }])) as LayerData["modes"],
    motionGroup: l.group,
    anim: { alwaysPulses: l.pulses === true, alwaysRotates: l.rotates === true },
  }));
  const v: VariantData = {
    ops,
    argCounts,
    masters: {
      4: {
        args,
        viewBox: [0, 0, 20, 20],
        transform: [0.1, 0, 0, 0.1, 0, 0],
        metrics: { referencePointSize: 20, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 },
        metricCenter: METRIC,
        rotationAnchor: ANCHOR,
      },
    },
    layers,
    variableValueMode: "color",
    vcContinuous: false,
    anim,
  };
  return toAnimDrawing(v, interpolate(v, 4));
}

/** `n` layers, one per motion group (ids 10, 20, … so compaction matters). */
const groups = (n: number, extra: Partial<L> = {}): L[] => Array.from({ length: n }, (_, i) => ({ group: (i + 1) * 10, ...extra }));

const spec = (kind: EffectKind, over: Partial<Spec> = {}): Spec => ({ ...defaultSpec(kind), ...over });

/** Uniform scale of a transform without rotation. */
const scaleOf = (s: LayerState) => Math.hypot(s.transform[0], s.transform[1]);
/** The rotation angle of a transform (y-down: positive is clockwise on screen). */
const angleOf = (s: LayerState) => Math.atan2(s.transform[1], s.transform[0]);
const apply = (s: LayerState, x: number, y: number): [number, number] => {
  const m = s.transform;
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
};
/** The angle `a` normalised to (−π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function expectSane(states: LayerState[]) {
  for (const s of states) {
    for (const v of [...s.transform, s.alpha]) expect(Number.isFinite(v)).toBe(true);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
  }
}

// float32 constants of 07, as printed there
const D13 = f(0.21666666865348816); // 13/60, §7.1
const STEP = f(0.05000000074505806); // §4.2 ceiling
const PI = f(3.1415927410125732); // §7.5

// ---- Bounce (07 §7.1) ----------------------------------------------------------------------

describe("bounce (07 §7.1)", () => {
  it("whole symbol, up: 1 → 1.25 at 13/60 → 0.909 at 26/60 → 1 at 0.7", () => {
    const d = drawing(groups(3));
    const s = spec("bounce", { byLayer: false });
    expect(duration(d, s)).toBeCloseTo(0.7, 6);
    for (const st of sample(d, s, 0)) expect(scaleOf(st)).toBe(1);
    for (const st of sample(d, s, D13)) expect(scaleOf(st)).toBeCloseTo(1.25, 6);
    for (const st of sample(d, s, 2 * D13)) expect(scaleOf(st)).toBeCloseTo(f(0.9089999794960022), 6);
    for (const st of sample(d, s, 0.7)) expect(scaleOf(st)).toBeCloseTo(1, 12);
    // pivot: the metric centre
    expect(apply(sample(d, s, D13)[0]!, ...METRIC)).toEqual([50, 50].map((v) => expect.closeTo(v, 9)));
    // on curve 3 from 1 to 1.25
    expect(scaleOf(sample(d, s, D13 / 2)[0]!)).toBeCloseTo(1 + 0.25 * curve(3)(0.5), 6);
  });

  it("down: 0.75 then 1.109", () => {
    const d = drawing(groups(1));
    const s = spec("bounce", { direction: "down" });
    expect(scaleOf(sample(d, s, D13)[0]!)).toBeCloseTo(0.75, 6);
    expect(scaleOf(sample(d, s, 2 * D13)[0]!)).toBeCloseTo(f(1.1089999675750732), 6);
  });

  it("by layer, up: ascending, 0.05 apart under 4 groups, every group ends at 0.7 (§4.3)", () => {
    const d = drawing(groups(3));
    const s = spec("bounce");
    const at = (t: number) => sample(d, s, t).map(scaleOf);
    expect(at(D13)[0]).toBeCloseTo(1.25, 6);
    expect(at(D13)[1]).toBeLessThan(1.25);
    expect(at(STEP + D13)[1]).toBeCloseTo(1.25, 6);
    expect(at(2 * STEP + D13)[2]).toBeCloseTo(1.25, 6);
    expect(at(0.7)).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
    expect(at(0.69).every((v) => v !== 1)).toBe(true);
    expect(duration(d, s)).toBeCloseTo(0.7, 6);
  });

  it("by layer, down: descending, the last group leads (§4.4)", () => {
    const d = drawing(groups(3));
    const s = spec("bounce", { direction: "down" });
    expect(scaleOf(sample(d, s, D13)[2]!)).toBeCloseTo(0.75, 6);
    expect(scaleOf(sample(d, s, 2 * STEP + D13)[0]!)).toBeCloseTo(0.75, 6);
  });

  it("continuous: intro 1 → 1.05 → 0.95, loop period 0.4333, clock delay per group (§4.6)", () => {
    const d = drawing(groups(3));
    const s = spec("bounce", { repeat: "continuous" });
    const period = f(0.4333333373069763);
    expect(duration(d, s)).toBeCloseTo(period, 9);
    expect(loopStart(d, s)).toBeCloseTo(2 * D13 + 2 * STEP, 9);
    expect(scaleOf(sample(d, s, D13)[0]!)).toBeCloseTo(f(1.0499999523162842), 6);
    expect(scaleOf(sample(d, s, 2 * D13)[0]!)).toBeCloseTo(f(0.949999988079071), 6);
    expect(scaleOf(sample(d, s, STEP + D13)[1]!)).toBeCloseTo(f(1.0499999523162842), 6);
    // the loop: B → A → B
    expect(scaleOf(sample(d, s, 2 * D13 + D13)[0]!)).toBeCloseTo(f(1.0499999523162842), 6);
    const ls = loopStart(d, s);
    for (const t of [0, 0.1, 0.27, 0.4]) {
      const a = sample(d, s, ls + t).map(scaleOf);
      const b = sample(d, s, ls + t + period).map(scaleOf);
      a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 9));
    }
  });

  it("continuous down: A 0.95, B 1.059, and the delays reverse", () => {
    const d = drawing(groups(3));
    const s = spec("bounce", { repeat: "continuous", direction: "down" });
    expect(scaleOf(sample(d, s, D13)[2]!)).toBeCloseTo(f(0.949999988079071), 6);
    expect(scaleOf(sample(d, s, 2 * D13)[2]!)).toBeCloseTo(f(1.059000015258789), 6);
    expect(scaleOf(sample(d, s, 0.09)[0]!)).toBe(1); // group 0 waits 0.1: holds the intro's first value
    expect(scaleOf(sample(d, s, 2 * STEP + D13)[0]!)).toBeCloseTo(f(0.949999988079071), 6);
  });

  it("continuous with 5+ groups: delay 0.15 / (n − 1)", () => {
    const d = drawing(groups(6));
    const s = spec("bounce", { repeat: "continuous" });
    expect(loopStart(d, s)).toBeCloseTo(2 * D13 + f(0.15000000596046448), 9);
  });
});

// ---- Pulse (07 §7.2) -----------------------------------------------------------------------

describe("pulse (07 §7.2)", () => {
  const FLOOR = f(0.3);

  it("every layer: 1 → floor 0.3 at 1.0 → 1 at 2.0, on curve 1; no transform", () => {
    const d = drawing(groups(2));
    const s = spec("pulse");
    expect(duration(d, s)).toBe(2);
    for (const st of sample(d, s, 1)) {
      expect(st.alpha).toBeCloseTo(FLOOR, 12);
      expect(st.transform).toEqual([1, 0, 0, 1, 0, 0]);
    }
    expect(sample(d, s, 0.5)[0]!.alpha).toBeCloseTo(FLOOR + (1 - FLOOR) * (1 - curve(1)(0.5)), 12);
    expect(sample(d, s, 2)[0]!.alpha).toBe(1);
  });

  it("by layer with an alwaysPulses layer: only non-eraser always-pulses layers pulse", () => {
    const d = drawing([{ group: 1, pulses: true }, { group: 1 }, { group: 2, pulses: true, eraser: true }]);
    const [a, b, c] = sample(d, spec("pulse"), 1);
    expect(a!.alpha).toBeCloseTo(FLOOR, 12);
    expect(b!.alpha).toBe(1);
    expect(c!.alpha).toBe(1);
  });

  it("whole symbol: every layer pulses even with alwaysPulses layers", () => {
    const d = drawing([{ group: 1, pulses: true }, { group: 1 }]);
    for (const st of sample(d, spec("pulse", { byLayer: false }), 1)) expect(st.alpha).toBeCloseTo(FLOOR, 12);
  });

  it("hierarchical, by layer, always-pulses: floor alpha(m) / alpha(level), light and dark", () => {
    const layers: L[] = [
      { group: 1, role: "primary", pulses: true },
      { group: 1, role: "secondary", pulses: true },
      { group: 1, role: "tertiary", pulses: true },
      { group: 1, role: "primary" },
    ];
    const d = drawing(layers);
    const light = sample(d, spec("pulse", { renderingMode: "hierarchical" }), 1).map((s) => s.alpha);
    expect(light[0]).toBeCloseTo(0.5, 12);
    expect(light[1]).toBeCloseTo(2.0, 12); // a secondary layer brightens to primary
    expect(light[2]).toBeCloseTo(0.5 / 0.18, 12);
    expect(light[3]).toBe(1);
    const dark = sample(d, spec("pulse", { renderingMode: "hierarchical", appearance: "dark" }), 1).map((s) => s.alpha);
    expect(dark[2]).toBeCloseTo(2.0, 12);
  });

  it("hierarchical without always-pulses layers keeps the default floor", () => {
    const d = drawing([{ group: 1, role: "secondary" }]);
    expect(sample(d, spec("pulse", { renderingMode: "hierarchical" }), 1)[0]!.alpha).toBeCloseTo(FLOOR, 12);
  });

  it("continuous: the 2.0 s cycle repeats from 0", () => {
    const d = drawing(groups(2));
    const s = spec("pulse", { repeat: "continuous" });
    expect(duration(d, s)).toBe(2);
    expect(loopStart(d, s)).toBe(0);
    for (const t of [0.3, 1, 1.7]) expect(sample(d, s, t + 2)[0]!.alpha).toBeCloseTo(sample(d, s, t)[0]!.alpha, 12);
  });
});

// ---- Breathe (07 §7.3) ---------------------------------------------------------------------

describe("breathe (07 §7.3)", () => {
  const FLOOR = f(0.3);
  const PEAK = f(1.2000000476837158);

  it("whole symbol: scale 1.2 and pulse floor at 1.5, back at 3.0", () => {
    const d = drawing(groups(3));
    const s = spec("breathe", { byLayer: false });
    expect(duration(d, s)).toBe(3);
    for (const st of sample(d, s, 1.5)) {
      expect(scaleOf(st)).toBeCloseTo(PEAK, 9);
      expect(st.alpha).toBeCloseTo(FLOOR, 9);
    }
    expect(scaleOf(sample(d, s, 0.75)[0]!)).toBeCloseTo(1 + (PEAK - 1) * curve(2)(0.5), 9);
    for (const st of sample(d, s, 3)) {
      expect(scaleOf(st)).toBeCloseTo(1, 12);
      expect(st.alpha).toBe(1);
    }
  });

  it("plain: no pulse-alpha", () => {
    const d = drawing(groups(1));
    const st = sample(d, spec("breathe", { breathePlain: true }), 1.5)[0]!;
    expect(scaleOf(st)).toBeCloseTo(PEAK, 9);
    expect(st.alpha).toBe(1);
  });

  it("by layer: step min(0.25/(n−1), 1/6), half = (3 − step·(n−1)) / 2; group i ends at 3 − step·(n−1−i)", () => {
    const d = drawing(groups(3));
    const s = spec("breathe");
    const step = 0.125;
    const half = (3 - 2 * step) / 2;
    expect(scaleOf(sample(d, s, half)[0]!)).toBeCloseTo(PEAK, 9);
    expect(scaleOf(sample(d, s, 2 * step + half)[2]!)).toBeCloseTo(PEAK, 9);
    expect(scaleOf(sample(d, s, 2 * half)[0]!)).toBeCloseTo(1, 12); // 2.75
    expect(scaleOf(sample(d, s, 2 * half)[2]!)).not.toBeCloseTo(1, 3);
    expect(duration(d, s)).toBeCloseTo(3, 12);
  });

  it("two groups: the ceiling 1/6 binds", () => {
    const d = drawing(groups(2));
    const step = f(0.1666666716337204);
    const half = (3 - step) / 2;
    expect(scaleOf(sample(d, spec("breathe"), step + half)[1]!)).toBeCloseTo(PEAK, 9);
  });

  it("by layer with always-pulses: only those dim, every layer breathes", () => {
    const d = drawing([{ group: 1, pulses: true }, { group: 1 }]);
    const [a, b] = sample(d, spec("breathe"), 1.5);
    expect(a!.alpha).toBeCloseTo(FLOOR, 9);
    expect(b!.alpha).toBe(1);
    expect(scaleOf(b!)).toBeCloseTo(PEAK, 9);
  });

  it("continuous repeats with period 3.0", () => {
    const d = drawing(groups(3));
    const s = spec("breathe", { repeat: "continuous" });
    expect(duration(d, s)).toBe(3);
    expect(loopStart(d, s)).toBe(0);
    for (const t of [0.4, 1.5, 2.9]) {
      const a = sample(d, s, t);
      const b = sample(d, s, t + 3);
      a.forEach((st, i) => expect(scaleOf(b[i]!)).toBeCloseTo(scaleOf(st), 9));
    }
  });
});

// ---- Wiggle (07 §7.4) ----------------------------------------------------------------------

describe("wiggle (07 §7.4)", () => {
  const D = f(0.16699999570846558);
  const ROT = [f(0.1745329201221466), f(-0.13962633907794952), f(0.10471975803375244), f(-0.0872664600610733), 0];
  const TRANS = [f(0.05999999865889549), f(-0.03999999910593033), f(0.029999999329447746), f(-0.02500000037252903), 0];
  const beat = (k: number) => (k < 4 ? (k + 1) * D : 4 * D + f(0.2670000195503235));

  it("clockwise, whole symbol: symbol rotation 10°, −8°, 6°, −5°, 0 about the metric centre", () => {
    const d = drawing(groups(2), { wiggleStyle: "clockwise" });
    const s = spec("wiggle", { byLayer: false });
    expect(duration(d, s)).toBeCloseTo(0.935, 6);
    ROT.forEach((a, k) => {
      for (const st of sample(d, s, beat(k))) expect(angleOf(st)).toBeCloseTo(a, 6);
    });
    const st = sample(d, s, beat(0))[0]!;
    expect(apply(st, ...METRIC)).toEqual(METRIC.map((v) => expect.closeTo(v, 9)));
  });

  it("clockwise, by layer: layer rotation about the anchor, ascending 0.05 apart, all end at 0.935", () => {
    const d = drawing(groups(3), { wiggleStyle: "clockwise" });
    const s = spec("wiggle");
    const st = sample(d, s, beat(0));
    expect(angleOf(st[0]!)).toBeCloseTo(ROT[0]!, 6);
    expect(apply(st[0]!, ...ANCHOR)).toEqual(ANCHOR.map((v) => expect.closeTo(v, 9)));
    expect(angleOf(sample(d, s, STEP + beat(0))[1]!)).toBeCloseTo(ROT[0]!, 6);
    expect(angleOf(sample(d, s, 2 * STEP + beat(2))[2]!)).toBeCloseTo(ROT[2]!, 6);
    for (const x of sample(d, s, beat(4))) expect(angleOf(x)).toBeCloseTo(0, 9);
  });

  it("counterClockwise negates every value", () => {
    const d = drawing(groups(1), { wiggleStyle: "counterClockwise" });
    ROT.forEach((a, k) => expect(angleOf(sample(d, spec("wiggle"), beat(k))[0]!)).toBeCloseTo(-a, 6));
  });

  it("linear (and absent): translation along wiggleAngle, × point size, 0° = +x, 90° = +y (down)", () => {
    // point size 20, transform ×0.1: 1 output unit is 10 path units
    for (const anim of [{ wiggleStyle: "linear" }, {}]) {
      const d = drawing(groups(1), anim);
      TRANS.forEach((v, k) => {
        const st = sample(d, spec("wiggle"), beat(k))[0]!;
        expect(st.transform[4]).toBeCloseTo(v * 20 * 10, 4);
        expect(st.transform[5]).toBeCloseTo(0, 9);
      });
    }
    const d90 = drawing(groups(1), { wiggleStyle: "linear", wiggleAngle: 90 });
    const st = sample(d90, spec("wiggle"), beat(0))[0]!;
    expect(st.transform[4]).toBeCloseTo(0, 9);
    expect(st.transform[5]).toBeCloseTo(TRANS[0]! * 200, 4);
  });

  it("continuous: intro 0 → +A → −A → 0, loop period 1/3, clock delay never reversed", () => {
    const d = drawing(groups(3), { wiggleStyle: "clockwise" });
    const s = spec("wiggle", { repeat: "continuous" });
    const A = f(0.0872664600610733);
    const q = f(0.0833333358168602);
    const h = f(0.1666666716337204);
    const intro = q + h + q;
    expect(duration(d, s)).toBeCloseTo(f(0.3333333432674408), 9);
    expect(loopStart(d, s)).toBeCloseTo(intro + 2 * STEP, 9);
    expect(angleOf(sample(d, s, q)[0]!)).toBeCloseTo(A, 6);
    expect(angleOf(sample(d, s, q + h)[0]!)).toBeCloseTo(-A, 6);
    expect(angleOf(sample(d, s, intro)[0]!)).toBeCloseTo(0, 6);
    expect(angleOf(sample(d, s, intro + q)[0]!)).toBeCloseTo(A, 6);
    expect(angleOf(sample(d, s, STEP + q)[1]!)).toBeCloseTo(A, 6);
    const ccw = drawing(groups(1), { wiggleStyle: "counterClockwise" });
    expect(angleOf(sample(ccw, s, q)[0]!)).toBeCloseTo(-A, 6);
    const lin = drawing(groups(1), {});
    expect(sample(lin, s, q)[0]!.transform[4]).toBeCloseTo(f(0.02500000037252903) * 200, 4);
  });
});

// ---- Rotate (07 §7.5) ----------------------------------------------------------------------

describe("rotate (07 §7.5)", () => {
  const TWO_PI = 2 * PI;

  it("whole symbol: 0 → 2π over 2.0 s on curve 10, about the metric centre, clockwise by default", () => {
    const d = drawing(groups(2));
    const s = spec("rotate", { byLayer: false });
    expect(duration(d, s)).toBe(2);
    for (const t of [0.3, 0.5, 1, 1.6]) {
      const want = wrap(TWO_PI * curve(10)(t / 2));
      for (const st of sample(d, s, t)) expect(angleOf(st)).toBeCloseTo(want, 6);
    }
    const st = sample(d, s, 0.3)[0]!;
    expect(apply(st, ...METRIC)).toEqual(METRIC.map((v) => expect.closeTo(v, 9)));
    expect(angleOf(st)).toBeGreaterThan(0); // positive = clockwise in y-down
    for (const x of sample(d, s, 2)) expect(wrap(angleOf(x))).toBeCloseTo(0, 6);
  });

  it("rotatesClockwise false turns −2π", () => {
    const d = drawing(groups(1), { rotatesClockwise: false });
    const t = 0.3;
    expect(angleOf(sample(d, spec("rotate"), t)[0]!)).toBeCloseTo(wrap(-TWO_PI * curve(10)(t / 2)), 6);
    const cw = drawing(groups(1), { rotatesClockwise: true });
    expect(angleOf(sample(cw, spec("rotate"), t)[0]!)).toBeCloseTo(wrap(TWO_PI * curve(10)(t / 2)), 6);
  });

  it("rotateDirection overrides the document's rotatesClockwise; default leaves it [INF]", () => {
    const t = 0.3;
    const plus = wrap(TWO_PI * curve(10)(t / 2));
    const ccwDoc = drawing(groups(1), { rotatesClockwise: false });
    const cwDoc = drawing(groups(1), { rotatesClockwise: true });
    const at = (d: AnimDrawing, rotateDirection: Spec["rotateDirection"]) => angleOf(sample(d, spec("rotate", { rotateDirection }), t)[0]!);
    expect(defaultSpec("rotate").rotateDirection).toBe("default");
    expect(at(ccwDoc, "default")).toBeCloseTo(-plus, 6);
    expect(at(ccwDoc, "clockwise")).toBeCloseTo(plus, 6);
    expect(at(cwDoc, "counterClockwise")).toBeCloseTo(-plus, 6);
    expect(at(cwDoc, "clockwise")).toBeCloseTo(plus, 6);
  });

  it("by layer without alwaysRotates layers: every layer turns together (one group)", () => {
    const d = drawing(groups(3));
    const st = sample(d, spec("rotate"), 0.5);
    for (const x of st) expect(angleOf(x)).toBeCloseTo(wrap(TWO_PI * curve(10)(0.25)), 6);
    expect(apply(st[0]!, ...METRIC)).toEqual(METRIC.map((v) => expect.closeTo(v, 9)));
  });

  it("by layer with alwaysRotates: only those turn, about the anchor; 3 groups at 0.1333 steps over 1.7333", () => {
    const d = drawing([
      { group: 1, rotates: true },
      { group: 2 },
      { group: 3, rotates: true },
    ]);
    const s = spec("rotate");
    const step = f(0.13333334028720856);
    const dur = f(1.7333333492279053);
    const st = sample(d, s, 1);
    expect(angleOf(st[0]!)).toBeCloseTo(wrap(TWO_PI * curve(10)(1 / dur)), 6);
    expect(apply(st[0]!, ...ANCHOR)).toEqual(ANCHOR.map((v) => expect.closeTo(v, 9)));
    expect(st[1]!.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(angleOf(st[2]!)).toBeCloseTo(wrap(TWO_PI * curve(10)((1 - 2 * step) / dur)), 6);
    expect(duration(d, s)).toBeCloseTo(2, 6);
  });

  it("2 groups: fixed step 0.1333, duration 1.8667", () => {
    const d = drawing([{ group: 1, rotates: true }, { group: 2, rotates: true }]);
    const step = f(0.13333334028720856);
    const dur = f(1.8666666746139526);
    const st = sample(d, spec("rotate"), 1);
    expect(angleOf(st[1]!)).toBeCloseTo(wrap(TWO_PI * curve(10)((1 - step) / dur)), 6);
    expect(duration(d, spec("rotate"))).toBeCloseTo(2, 6);
  });

  it("continuous, 1 group: intro 2.5 s on curve 11, then a linear 2.0 s turn", () => {
    const d = drawing(groups(1));
    const s = spec("rotate", { repeat: "continuous" });
    expect(duration(d, s)).toBe(2);
    expect(loopStart(d, s)).toBeCloseTo(2.5, 9);
    expect(angleOf(sample(d, s, 1)[0]!)).toBeCloseTo(wrap(TWO_PI * curve(11)(1 / 2.5)), 6);
    expect(angleOf(sample(d, s, 3)[0]!)).toBeCloseTo(TWO_PI * 0.25, 6); // curve 12 is linear
    expect(angleOf(sample(d, s, 5)[0]!)).toBeCloseTo(TWO_PI * 0.25, 6);
  });

  it("continuous, n ≥ 2: staggered intro to ±2·0.5297 at s_i + 2/3, all ending at 2.5, then in unison", () => {
    const d = drawing(groups(3, { rotates: true }), { rotatesClockwise: false });
    const s = spec("rotate", { repeat: "continuous" });
    const si = f(0.0833333358168602);
    const mid = -2 * f(0.5297074317932129);
    const t1 = f(0.6666666865348816);
    expect(angleOf(sample(d, s, t1)[0]!)).toBeCloseTo(mid, 6);
    expect(angleOf(sample(d, s, 2 * si + t1)[2]!)).toBeCloseTo(mid, 6);
    expect(loopStart(d, s)).toBeCloseTo(2.5, 6);
    const after = sample(d, s, 3).map(angleOf);
    for (const a of after) expect(a).toBeCloseTo(-TWO_PI * 0.25, 6);
  });
});

// ---- Scale (07 §7.6) -----------------------------------------------------------------------

describe("scale (07 §7.6)", () => {
  it("up (default): 1 → 1.25 over 0.25 on curve 1, held", () => {
    const d = drawing(groups(1));
    const s = spec("scale");
    expect(duration(d, s)).toBe(0.25);
    expect(scaleOf(sample(d, s, 0.125)[0]!)).toBeCloseTo(1 + 0.25 * curve(1)(0.5), 12);
    expect(scaleOf(sample(d, s, 0.25)[0]!)).toBe(1.25);
    expect(scaleOf(sample(d, s, 10)[0]!)).toBe(1.25);
    expect(apply(sample(d, s, 1)[0]!, ...METRIC)).toEqual(METRIC.map((v) => expect.closeTo(v, 9)));
  });

  it("down (direction down, or reversed with default): 1 → 0.5 on curve 41", () => {
    const d = drawing(groups(1));
    for (const s of [spec("scale", { direction: "down" }), spec("scale", { reversed: true })]) {
      expect(scaleOf(sample(d, s, 0.125)[0]!)).toBeCloseTo(1 - 0.5 * curve(41)(0.5), 12);
      expect(scaleOf(sample(d, s, 0.25)[0]!)).toBe(0.5);
    }
    expect(scaleOf(sample(d, spec("scale", { direction: "up", reversed: true }), 1)[0]!)).toBe(1.25);
  });

  it("up by layer: every group starts at 0, group i lasts 0.25 − step·(n−1−i)", () => {
    const d = drawing(groups(3));
    const st = sample(d, spec("scale"), 0.15);
    expect(scaleOf(st[0]!)).toBeCloseTo(1.25, 6);
    expect(scaleOf(st[2]!)).toBeCloseTo(1 + 0.25 * curve(1)(0.15 / 0.25), 6);
    expect(scaleOf(sample(d, spec("scale"), 0.01)[2]!)).toBeGreaterThan(1);
  });

  it("down by layer: descending starts, all end at 0.25", () => {
    const d = drawing(groups(3));
    const s = spec("scale", { direction: "down" });
    expect(scaleOf(sample(d, s, 2 * STEP)[0]!)).toBe(1);
    expect(scaleOf(sample(d, s, 0.05)[2]!)).toBeLessThan(1);
    for (const st of sample(d, s, 0.25)) expect(scaleOf(st)).toBeCloseTo(0.5, 9);
  });
});

// ---- Appear and Disappear (07 §7.7) --------------------------------------------------------

describe("appear (07 §7.7)", () => {
  it("default (up): hidden at 0.75 → shown at 1 over 0.25 (alpha curve 14, scale curve 15)", () => {
    const d = drawing(groups(1));
    const s = spec("appear");
    expect(duration(d, s)).toBe(0.25);
    const start = sample(d, s, 0)[0]!;
    expect(start.alpha).toBe(0);
    expect(start.visible).toBe(false);
    expect(scaleOf(start)).toBe(0.75);
    const mid = sample(d, s, 0.125)[0]!;
    expect(mid.alpha).toBeCloseTo(curve(14)(0.5), 12);
    expect(scaleOf(mid)).toBeCloseTo(0.75 + 0.25 * curve(15)(0.5), 12);
    const end = sample(d, s, 0.25)[0]!;
    expect(end.alpha).toBe(1);
    expect(end.visible).toBe(true);
    expect(scaleOf(end)).toBe(1);
  });

  it("down: from 1.25", () => {
    expect(scaleOf(sample(drawing(groups(1)), spec("appear", { direction: "down" }), 0)[0]!)).toBe(1.25);
  });

  it("up by layer: ascending, 0.05 apart, every group ends at 0.25", () => {
    const d = drawing(groups(3));
    const st = sample(d, spec("appear"), 0.05);
    expect(st[0]!.visible).toBe(true);
    expect(st[1]!.visible).toBe(false); // starts exactly at 0.05: clip-alpha still 0
    expect(st[2]!.visible).toBe(false);
    expect(sample(d, spec("appear"), 0.12)[2]!.visible).toBe(true);
    for (const x of sample(d, spec("appear"), 0.25)) expect(x.alpha).toBeCloseTo(1, 9);
  });

  it("down by layer: descending, the last group leads", () => {
    const d = drawing(groups(3));
    const st = sample(d, spec("appear", { direction: "down" }), 0.05);
    expect(st[2]!.visible).toBe(true);
    expect(st[0]!.visible).toBe(false);
  });
});

describe("disappear (07 §7.7)", () => {
  const T = f(0.1666666716337204);
  const DSTEP = f(0.03333333507180214);

  it("default (up): 1 → hidden at 0.75 over 1/6 (alpha curve 14, scale curve 16)", () => {
    const d = drawing(groups(1));
    const s = spec("disappear");
    expect(duration(d, s)).toBeCloseTo(T, 12);
    const start = sample(d, s, 0)[0]!;
    expect(start.alpha).toBe(1);
    expect(scaleOf(start)).toBe(1);
    const mid = sample(d, s, T / 2)[0]!;
    expect(mid.alpha).toBeCloseTo(1 - curve(14)(0.5), 9);
    expect(scaleOf(mid)).toBeCloseTo(1 - 0.25 * curve(16)(0.5), 9);
    const end = sample(d, s, T)[0]!;
    expect(end.visible).toBe(false);
    expect(end.alpha).toBe(0);
    expect(scaleOf(end)).toBe(0.75);
  });

  it("down: to 1.25", () => {
    expect(scaleOf(sample(drawing(groups(1)), spec("disappear", { direction: "down" }), 1)[0]!)).toBe(1.25);
  });

  it("up by layer: descending at 1/30 steps; down: ascending; all gone at 1/6", () => {
    const d = drawing(groups(3));
    const up = sample(d, spec("disappear"), DSTEP);
    expect(up[2]!.alpha).toBeLessThan(1);
    expect(up[0]!.alpha).toBe(1);
    const down = sample(d, spec("disappear", { direction: "down" }), DSTEP);
    expect(down[0]!.alpha).toBeLessThan(1);
    expect(down[2]!.alpha).toBe(1);
    for (const x of sample(d, spec("disappear"), T)) expect(x.visible).toBe(false);
  });
});

// ---- Review Focus 1: the stagger always fits ----------------------------------------------

describe("the stagger always fits (07 §4.7, Review Focus 1)", () => {
  const TOTAL: Record<string, number> = {
    bounce: 0.7,
    pulse: 2,
    breathe: 3,
    wiggle: 0.935,
    rotate: 2,
    scale: 0.25,
    appear: 0.25,
    disappear: f(0.1666666716337204),
  };
  const INTRO: Record<string, number> = { bounce: 2 * D13, wiggle: 1 / 3, rotate: 2.5, pulse: 0, breathe: 0 };
  /** 07 §4.3: these end every group together. */
  const COMMON_END = new Set(["bounce", "wiggle", "appear", "disappear"]);

  for (const kind of Object.keys(TOTAL) as EffectKind[]) {
    it(`${kind}: 1, 2, 3, 4, 5, 9 and 16 groups, every start ≥ 0 and every end within the total`, () => {
      for (const n of [1, 2, 3, 4, 5, 9, 16]) {
        const d = drawing(groups(n, { rotates: true, pulses: true }), { wiggleStyle: "clockwise" });
        for (const byLayer of [true, false]) {
          for (const repeat of ["once", "continuous"] as const) {
            for (const direction of ["up", "down"] as const) {
              const s = spec(kind, { byLayer, repeat, direction });
              const plan = BUILTIN_PLANS[kind]!(d, s);
              const looping = plan.loop !== undefined;
              const limit = looping ? INTRO[kind]! : TOTAL[kind]!;
              const ends: number[] = [];
              for (const tr of [...plan.tracks, ...(plan.loop?.tracks ?? [])]) {
                expect(Number.isFinite(tr.start)).toBe(true);
                expect(tr.start).toBeGreaterThanOrEqual(0);
                for (const seg of tr.segments) {
                  expect(Number.isFinite(seg.duration)).toBe(true);
                  expect(seg.duration).toBeGreaterThan(0);
                  expect(Number.isFinite(seg.to)).toBe(true);
                }
              }
              for (const tr of plan.tracks) {
                const e = trackEnd(tr);
                ends.push(e);
                expect(e).toBeLessThanOrEqual(limit + 1e-6);
              }
              for (const tr of plan.loop?.tracks ?? []) expect(trackEnd(tr)).toBeLessThanOrEqual(plan.loop!.period + 1e-6);
              for (const g of plan.groupDelay ?? []) {
                expect(g).toBeGreaterThanOrEqual(0);
                expect(g).toBeLessThanOrEqual(f(0.15000000596046448) + 1e-9);
              }
              if (!looping) expect(duration(d, s)).toBeCloseTo(TOTAL[kind]!, 6);
              if (!looping && COMMON_END.has(kind)) for (const e of ends) expect(e).toBeCloseTo(TOTAL[kind]!, 6);
              for (let t = -0.5; t < 6; t += 0.0731) expectSane(sample(d, s, t));
            }
          }
        }
      }
    });
  }
});
