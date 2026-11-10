import { describe, expect, it } from "vitest";
import { interpolate, type LayerData, type RenderMode, type VariantData } from "@opensymbols/core";
import { defaultSpec, duration, sample, toAnimDrawing, type AnimDrawing, type Spec, type Track } from "../src/index.js";
import { BUILTIN_PLANS } from "../src/effects/index.js";
import { curve } from "../src/curves.js";

// ---- fixture -------------------------------------------------------------------------------

const f = Math.fround;
const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

interface L {
  group?: number;
  /** A bar `len` long, 5 thick, drawn left to right (speed `len`, 08 §12.1); absent = no keyframes. */
  len?: number;
  family?: number;
}

/**
 * One bar per layer. Transform ×0.01 over a reference point size of 20.48, so a layer's stroke
 * length in point sizes is `len / 2048` (08 §3).
 */
function drawing(spec: L[], anim: Record<string, unknown> = {}): AnimDrawing {
  const ops = "MLLLZ".repeat(spec.length);
  const argCounts = spec.flatMap(() => [2, 2, 2, 2, 0]);
  const args = spec.flatMap((l) => {
    const n = l.len ?? 95;
    return [0, 0, n, 0, n, 5, 0, 5];
  });
  const layers: LayerData[] = spec.map((l, i) => {
    const n = l.len ?? 95;
    const total = 2 * n + 10;
    return {
      cmd: [i * 5, i * 5 + 5],
      role: "primary",
      modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: false }])) as LayerData["modes"],
      motionGroup: l.group ?? 0,
      anim: {
        familyLayer: l.family ?? -1,
        ...(l.len !== undefined
          ? {
              strokeKeyframes: [
                { flags: 0, progress: 0, d0: 0, d1: (2 * n + 5) / total },
                { flags: 0, progress: 1, d0: n / total, d1: (n + 5) / total },
              ],
            }
          : {}),
      },
    };
  });
  const v: VariantData = {
    ops,
    argCounts,
    masters: {
      4: {
        args,
        viewBox: [0, 0, 20.48, 20.48],
        transform: [0.01, 0, 0, 0.01, 0, 0],
        metrics: { referencePointSize: 20.48, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 },
        metricCenter: [50, 2.5],
      },
    },
    layers,
    variableValueMode: "color",
    vcContinuous: false,
    anim,
  };
  return toAnimDrawing(v, interpolate(v, 4));
}

/** 07 §7.8 per-layer duration from a stroke length in point sizes. */
const dur = (len: number) => {
  const x = Math.min(Math.max((len / 2048) * f(0.17182131111621857), 0), 1);
  return x * (2 - x) * f(0.8666666746139526) + f(0.13333334028720856);
};
const TAIL = f(0.03333333507180214);
const draw = (over: Partial<Spec> = {}): Spec => ({ ...defaultSpec("draw"), ...over });
const plan = (d: AnimDrawing, s: Spec) => BUILTIN_PLANS.draw!(d, s);
const strokeTrack = (tracks: Track[], layer: number) =>
  tracks.find((t) => t.layer === layer && (t.property === "strokeEnd" || t.property === "strokeStart"))!;

// ---- stroke length (08 §3) -----------------------------------------------------------------

describe("toAnimDrawing: the stroke length in point sizes (08 §3)", () => {
  it("L_path · s / referencePointSize: 95 / 2048 for the 08 §12.1 bar; none on a non-strokable layer", () => {
    const d = drawing([{ len: 95 }, {}]);
    expect(d.layers[0]!.strokeLength).toBeCloseTo(95 / 2048, 12);
    expect(d.layers[1]!.strokeLength).toBeUndefined();
  });

  it("a family member without keyframes takes the family's maximum", () => {
    const d = drawing([{ len: 95, family: 0 }, { len: 300, family: 0 }, { family: 0 }]);
    for (const l of d.layers) expect(l.strokeLength).toBeCloseTo(300 / 2048, 12);
  });
});

// ---- Draw On / Off timing (07 §7.8) ---------------------------------------------------------

describe("Draw On and Off (07 §7.8)", () => {
  it("08 §12.1: x = 0.0079702, dur = 0.1470933 s", () => {
    const d = drawing([{ len: 95 }]);
    expect((95 / 2048) * f(0.17182131111621857)).toBeCloseTo(0.0079702, 7);
    expect(duration(d, draw())).toBeCloseTo(0.1470933, 6);
  });

  it("Draw On: stroke-end 0 → 1 on curve 17 over the layer's own duration", () => {
    const d = drawing([{ len: 95 }]);
    const D = dur(95);
    for (const k of [0, 0.3, 0.5, 0.9]) {
      const s = sample(d, draw(), k * D)[0]!;
      expect(s.strokeClip).toBe(true);
      expect(s.strokeStart).toBe(0);
      expect(s.strokeEnd).toBeCloseTo(curve(17)(k), 9);
    }
    expect(sample(d, draw(), D + 1)[0]!.strokeEnd).toBe(1);
  });

  it("Draw Off: stroke-start 0 → 0.99989998 on curve 18, the 1/30 s plateau, then 1; total dur + 1/30", () => {
    const d = drawing([{ len: 95 }]);
    const D = dur(95);
    expect(duration(d, draw({ reversed: true }))).toBeCloseTo(D + TAIL, 9);
    const at = (t: number) => sample(d, draw({ reversed: true }), t)[0]!;
    expect(at(D / 2).strokeStart).toBeCloseTo(f(0.9999) * curve(18)(0.5), 9);
    expect(at(D / 2).strokeEnd).toBe(1);
    expect(at(D + TAIL / 2).strokeStart).toBe(f(0.9999));
    expect(at(D + TAIL / 2).attachmentScale).toBeCloseTo(0.75, 6);
    expect(at(D + TAIL + 1e-6).strokeStart).toBe(1);
    expect(at(D + TAIL + 1e-6).attachmentScale).toBe(0);
  });

  it("Draw Off reversed (bit 30): stroke-end 1 → 1e-4 → plateau → 0, retracting to its start", () => {
    const d = drawing([{ len: 95 }]);
    const D = dur(95);
    const at = (t: number) => sample(d, draw({ reversed: true, drawReversedOrder: true }), t)[0]!;
    expect(at(D / 2).strokeEnd).toBeCloseTo(1 + (f(1e-4) - 1) * curve(18)(0.5), 9);
    expect(at(D / 2).strokeStart).toBe(0);
    expect(at(D + TAIL / 2).strokeEnd).toBe(f(1e-4));
    expect(at(D + TAIL + 1e-6).strokeEnd).toBe(0);
  });
});

describe("Draw group order and the chain (07 §7.8)", () => {
  const two = (anim: Record<string, unknown> = {}) => drawing([{ len: 95, group: 3 }, { len: 400, group: 7 }], anim);
  const D0 = dur(95);
  const D1 = dur(400);
  const starts = (d: AnimDrawing, s: Spec): [number, number] => [strokeTrack(plan(d, s).tracks, 0).start, strokeTrack(plan(d, s).tracks, 1).start];

  it("On ascending, each group 0.18 of the previous group's duration after it; total = latest end", () => {
    const d = two();
    const [a, b] = starts(d, draw());
    expect(a).toBe(0);
    expect(b).toBeCloseTo(f(0.18000000715255737) * D0, 9);
    expect(duration(d, draw())).toBeCloseTo(b + D1, 9);
  });

  it("drawReversesMotionGroups: descending", () => {
    const [a, b] = starts(two({ drawReversesMotionGroups: true }), draw());
    expect(b).toBe(0);
    expect(a).toBeCloseTo(f(0.18000000715255737) * D1, 9);
  });

  it("Off: fraction 0.38; Off reversed flips the order; with the document flag too it is ascending again", () => {
    const off = draw({ reversed: true });
    const [a, b] = starts(two(), off);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(f(0.3799999952316284) * D0, 9);
    const [ra, rb] = starts(two(), { ...off, drawReversedOrder: true });
    expect(rb).toBe(0);
    expect(ra).toBeCloseTo(f(0.3799999952316284) * D1, 9);
    const [xa, xb] = starts(two({ drawReversesMotionGroups: true }), { ...off, drawReversedOrder: true });
    expect(xa).toBe(0);
    expect(xb).toBeCloseTo(f(0.3799999952316284) * D0, 9);
  });

  it("drawReversedOrder means nothing on Draw On", () => {
    expect(starts(two(), draw({ drawReversedOrder: true }))).toEqual(starts(two(), draw()));
  });

  it("not by layer: every group starts at 0", () => {
    expect(starts(two(), draw({ byLayer: false }))).toEqual([0, 0]);
  });

  it("individually, more than one group: linear segments, fraction 1.0, the whole clock warped on curve 17", () => {
    const d = two();
    const s = draw({ drawIndividually: true });
    const p = plan(d, s);
    const [a, b] = starts(d, s);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(D0, 9);
    expect(strokeTrack(p.tracks, 0).segments[0]!.curve).toBe(0);
    const total = D0 + D1;
    expect(p.timeSpan).toBeCloseTo(total, 9);
    expect(p.timeCurve).toBe(17);
    const t = 0.05;
    const warped = total * curve(17)(t / total);
    expect(sample(d, s, t)[0]!.strokeEnd).toBeCloseTo(Math.min(warped / D0, 1), 9);
  });

  it("individually with one group is the plain Draw (bit 31 cleared)", () => {
    const d = drawing([{ len: 95 }]);
    const p = plan(d, draw({ drawIndividually: true }));
    expect(p.timeSpan).toBeUndefined();
    expect(strokeTrack(p.tracks, 0).segments[0]!.curve).toBe(17);
  });
});

describe("non-strokable layers appear or disappear instead (07 §7.8, 08 §12.4)", () => {
  it("one group: clip-alpha 0 → 1 on c14, scale 0.75 → 1 on c15 over 0.25 s; at t = 0.125 alpha 0.5, scale ≈ 0.947814", () => {
    const d = drawing([{}]);
    const s = sample(d, draw(), 0.125)[0]!;
    expect(curve(14)(0.5)).toBeCloseTo(0.5, 6);
    expect(curve(15)(0.5)).toBeCloseTo(0.791257, 6);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    expect(s.transform[0]).toBeCloseTo(0.947814, 6);
    expect(s.strokeClip).toBe(false);
    expect(duration(d, draw())).toBe(0.25);
  });

  it("Draw Off: the up Disappear, 1 → 0 on c14 and 1 → 0.75 on c16 over 0.1667 s", () => {
    const d = drawing([{}]);
    const T = f(0.1666666716337204);
    const s = sample(d, draw({ reversed: true }), T / 2)[0]!;
    expect(s.alpha).toBeCloseTo(1 - curve(14)(0.5), 6);
    expect(s.transform[0]).toBeCloseTo(1 - 0.25 * curve(16)(0.5), 6);
    expect(duration(d, draw({ reversed: true }))).toBeCloseTo(T, 9);
  });

  it("on Draw's group clock: a non-strokable group starts at its timing start and lasts T − offset_i", () => {
    const d = drawing([{ len: 95, group: 0 }, { group: 1 }]);
    const p = plan(d, draw());
    const appear = p.tracks.filter((t) => t.property === "clipAlpha");
    expect(appear.length).toBe(2);
    const g1 = appear.find((t) => t.group === 1)!;
    expect(g1.start).toBeCloseTo(f(0.18000000715255737) * dur(95), 9);
    expect(g1.segments[0]!.duration).toBeCloseTo(0.25 - f(0.05000000074505806), 9);
    // The fallback reaches only layers that do not animate their stroke.
    expect(g1.filter).toEqual({ mask: 0x10, value: 0 });
    const s = sample(d, draw(), 0.001);
    expect(s[0]!.alpha).toBe(1);
    expect(s[1]!.alpha).toBe(0);
  });

  it("no NaN anywhere over a sweep", () => {
    const d = drawing([{ len: 95, group: 0 }, { group: 1 }, { len: 3000, group: 2 }]);
    for (const over of [{}, { reversed: true }, { reversed: true, drawReversedOrder: true }, { drawIndividually: true }, { byLayer: false }]) {
      const s = draw(over);
      const T = duration(d, s);
      for (let t = -0.1; t <= T + 0.1; t += T / 37) {
        for (const st of sample(d, s, t)) {
          for (const v of [...st.transform, st.alpha, st.strokeStart, st.strokeEnd, st.attachmentScale]) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});
