import { describe, expect, it } from "vitest";
import { interpolate, type LayerData, type RenderMode, type VariantData } from "@opensymbols/core";
import { clipOutline, defaultSpec, duration, resolveRiders, sample, toAnimDrawing, type AnimDrawing, type LayerState, type Matrix } from "../src/index.js";
import { curve } from "../src/curves.js";

// ---- 08 §12.3 fixture: the bar plus a chevron riding its tip ---------------------------------

const f = Math.fround;
const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

/** Transform ×0.01 over a reference point size of 20.48: the stroke length is L_path / 2048 (08 §3). */
function barAndChevron(extra: Array<Record<string, unknown>> = []): AnimDrawing {
  const ops = "MLLLZMLLZ";
  const argCounts = [2, 2, 2, 2, 0, 2, 2, 2, 0];
  const args = [0, 0, 95, 0, 95, 5, 0, 5, 95, -5, 105, 2.5, 95, 10];
  const layers: LayerData[] = [
    {
      cmd: [0, 9],
      role: "primary",
      modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: false }])) as LayerData["modes"],
      motionGroup: 0,
      anim: {
        familyLayer: 0,
        strokeKeyframes: [
          { flags: 0, progress: 0, d0: 0, d1: 0.975 },
          { flags: 0, progress: 1, d0: 0.475, d1: 0.5 },
        ],
        attachments: [{ flags: 4, targetLayer: 0, targetSubpath: 0, dataIndex: 0, riders: [1] }, ...extra],
      },
    },
  ];
  const v: VariantData = {
    ops,
    argCounts,
    masters: {
      4: {
        args,
        viewBox: [0, 0, 20.48, 20.48],
        transform: [0.01, 0, 0, 0.01, 0, 0],
        metrics: { referencePointSize: 20.48, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 },
      },
    },
    layers,
    variableValueMode: "color",
    vcContinuous: false,
    anim: { drawAttachmentData: [{ a: 1, b: 0, anchorX: 0, anchorY: 0 }, { a: 1, b: 0.8, anchorX: 0, anchorY: 0 }] },
  };
  return toAnimDrawing(v, interpolate(v, 4));
}

function state(lo: number, hi: number, attachmentScale = 1): LayerState {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    alpha: 1,
    visible: true,
    strokeStart: lo,
    strokeEnd: hi,
    strokeClip: true,
    attachmentScale,
    subpathTransforms: [],
  };
}

const apply = (m: Matrix, [x, y]: [number, number]): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function expectPoint(p: [number, number], q: [number, number], tol = 1e-6) {
  expect(Math.abs(p[0] - q[0])).toBeLessThanOrEqual(tol);
  expect(Math.abs(p[1] - q[1])).toBeLessThanOrEqual(tol);
}

function riders(lo: number, hi: number, scale = 1) {
  const d = barAndChevron();
  const states = [state(lo, hi, scale)];
  resolveRiders(d, states);
  return states[0]!.subpathTransforms;
}

describe("08 §12.3: a rider following the tip", () => {
  it("the stroke length is 95 / 2048 point sizes", () => {
    expect(barAndChevron().layers[0]!.strokeLength).toBeCloseTo(95 / 2048, 12);
  });

  it("Draw On at 0.5: the chevron sits on the tip at three quarters of its size", () => {
    const t = riders(0, 0.5);
    expect(t.length).toBe(1);
    expect(t[0]!.subpath).toBe(1);
    const m = t[0]!.transform;
    expectPoint(apply(m, [95, -5]), [47.5, -3.75]);
    expectPoint(apply(m, [105, 2.5]), [55, 1.875]);
    expectPoint(apply(m, [95, 10]), [47.5, 7.5]);
  });

  it("the clip then draws the moved chevron whole (subpath 1 has no records)", () => {
    const d = barAndChevron();
    const states = [state(0, 0.5)];
    resolveRiders(d, states);
    const p = d.layers[0]!.path;
    const out = clipOutline(p.ops, p.argCounts, p.args, [0, p.ops.length], d.layers[0]!.strokeKeyframes, 0, 0.5, states[0]!.subpathTransforms);
    expect(out.endsWith("M47.5 -3.75L55 1.875L47.5 7.5Z")).toBe(true);
  });

  it("resolveRiders is idempotent: twice equals once (entries replaced by subpath)", () => {
    for (const [lo, hi, k] of [[0, 0.5, 1], [0, 0], [f(0.9999), 1, 0.5]] as Array<[number, number, number?]>) {
      const d = barAndChevron();
      const once = [state(lo, hi, k ?? 1)];
      resolveRiders(d, once);
      const twice = [state(lo, hi, k ?? 1)];
      resolveRiders(d, twice);
      resolveRiders(d, twice);
      expect(twice[0]!.subpathTransforms).toEqual(once[0]!.subpathTransforms);
      expect(once[0]!.subpathTransforms.length).toBe(1);
    }
  });

  it("two attachments on one rider subpath: one entry, the last attachment wins", () => {
    const d = barAndChevron([{ flags: 4, targetLayer: 0, targetSubpath: 0, dataIndex: 1, riders: [1] }]);
    const states = [state(0, 0.5)];
    resolveRiders(d, states);
    // The second attachment's b = 0.8 > hi hides the chevron (08 §11.4).
    expect(states[0]!.subpathTransforms).toEqual([{ subpath: 1, transform: [0, 0, 0, 0, 95, -5] }]);
  });

  it("Draw On at 1: nothing is resolved; at 0: hidden, collapsed to its start point", () => {
    expect(riders(0, 1)).toEqual([]);
    const t = riders(0, 0);
    expect(t.length).toBe(1);
    expect(t[0]!.transform).toEqual([0, 0, 0, 0, 95, -5]);
  });

  it("Draw Off at 0.5: visible, no tip, scale 1 → the chevron stays at the bar's end", () => {
    expect(riders(0.5, 1)).toEqual([]);
  });

  it("the Off plateau [0.99989998, 1]: visible (float32 span ≥ 1e-4); the scale ramp scales it about (95, 2.5)", () => {
    expect(riders(f(0.9999), 1)).toEqual([]);
    const t = riders(f(0.9999), 1, 0.5);
    expect(t.length).toBe(1);
    expectPoint(apply(t[0]!.transform, [105, 2.5]), [100, 2.5]);
    expectPoint(apply(t[0]!.transform, [95, 2.5]), [95, 2.5]);
  });

  it("after the plateau the range is [1, 1]: hidden", () => {
    expect(riders(1, 1, 0)[0]!.transform).toEqual([0, 0, 0, 0, 95, -5]);
  });

  it("the float32 plateau span clears the float32 threshold; the all-double one would not clear 1e-4 (07 §2.8)", () => {
    expect(1 - f(0.9999)).toBeGreaterThanOrEqual(f(1e-4));
    // (Against the float32 threshold the double span 9.99999999999989e-5 would still pass; it is
    // the all-double comparison that flips.)
    expect(1 - 0.9999).toBeLessThan(1e-4);
  });
});

describe("riders through sample (Draw)", () => {
  it("Draw On: the chevron rides the tip at x = 95 · hi with scale 0.5 + 0.5 · hi", () => {
    const d = barAndChevron();
    const spec = defaultSpec("draw");
    const T = duration(d, spec);
    for (const k of [0.25, 0.5, 0.75]) {
      const s = sample(d, spec, k * T)[0]!;
      const hi = s.strokeEnd;
      expect(hi).toBeCloseTo(curve(17)(k), 6);
      const m = s.subpathTransforms[0]!.transform;
      expect(m[0]).toBeCloseTo(0.5 + 0.5 * hi, 9);
      expectPoint(apply(m, [95, 0]), [95 * hi, 0], 1e-6);
    }
  });

  it("Draw Off: the plateau ramps the chevron's scale; [1, 1] hides it", () => {
    const d = barAndChevron();
    const spec = { ...defaultSpec("draw"), reversed: true };
    const dur = duration(d, spec) - f(0.03333333507180214);
    const mid = sample(d, spec, dur + f(0.03333333507180214) / 2)[0]!;
    expect(mid.strokeStart).toBe(f(0.9999));
    expect(mid.attachmentScale).toBeCloseTo(0.75, 6);
    expectPoint(apply(mid.subpathTransforms[0]!.transform, [105, 2.5]), [102.5, 2.5], 1e-5);
    const end = sample(d, spec, dur + 0.05)[0]!;
    expect(end.strokeStart).toBe(1);
    expect(end.subpathTransforms[0]!.transform).toEqual([0, 0, 0, 0, 95, -5]);
  });
});
