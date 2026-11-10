import { afterEach, describe, expect, it } from "vitest";
import { interpolate, type LayerData, type MasterData, type RenderMode, type VariantData } from "@opensymbols/core";
import {
  defaultSpec,
  duration,
  FILTER,
  loopStart,
  sample,
  toAnimDrawing,
  type AnimDrawing,
  type EffectKind,
  type LayerState,
  type Spec,
} from "../src/index.js";
import { registerPlan, specKey } from "../src/sample.js";
import { pulseHooks } from "../src/pulse.js";
import { curve } from "../src/curves.js";

// ---- fixture -------------------------------------------------------------------------------

const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];
const modes = (clearBehind = false) =>
  Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind }])) as LayerData["modes"];

const layer = (cmd: [number, number], motionGroup: number, anim: Record<string, unknown>, over: Partial<LayerData> = {}): LayerData => ({
  cmd,
  role: "primary",
  modes: modes(),
  motionGroup,
  anim,
  ...over,
});

// layer 0: square 0..100 (absolute); layer 1: triangle; layer 2: relative "m 200 200 l 10 10".
const OPS = "MLLLZ" + "MLLZ" + "ml";
const ARG_COUNTS = [2, 2, 2, 2, 0, 2, 2, 2, 0, 2, 2];
const ARGS = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0, 50, 0, 50, 50, 200, 200, 10, 10];

function variant(master: Partial<MasterData>, layers?: LayerData[]): VariantData {
  return {
    ops: OPS,
    argCounts: ARG_COUNTS,
    masters: { 4: { args: ARGS, viewBox: [0, 0, 20, 20], transform: [0.1, 0, 0, 0.1, 0, 0], ...master } },
    layers: layers ?? [
      layer([0, 5], 5, { alwaysRotates: true, tags: ["_badge"] }),
      layer([5, 9], 2, { strokeKeyframes: [{ flags: 0, progress: 0, d0: 0, d1: 0 }], familyLayer: 3 }),
      layer([9, 11], 2, { familyLayer: 3 }, { variableThreshold: 0.5 }),
    ],
    variableValueMode: "color",
    vcContinuous: false,
    anim: { drawReversesMotionGroups: true, wiggleStyle: "clockwise", wiggleAngle: 30, rotatesClockwise: false },
  };
}

const ANCHORED = { metrics: { referencePointSize: 20, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 }, metricCenter: [50, 50] as [number, number], rotationAnchor: [10, 20] as [number, number] };

function drawing(master: Partial<MasterData> = ANCHORED, layers?: LayerData[]): AnimDrawing {
  const v = variant(master, layers);
  return toAnimDrawing(v, interpolate(v, 4));
}

/** Apply an SVG matrix [a b c d e f] to a point. */
const apply = (m: LayerState["transform"], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const ID: LayerState["transform"] = [1, 0, 0, 1, 0, 0];
const spec = (kind: EffectKind, over: Partial<Spec> = {}): Spec => ({ ...defaultSpec(kind), ...over });

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});
const register = (...a: Parameters<typeof registerPlan>) => cleanups.push(registerPlan(...a));

function expectFinite(states: LayerState[]) {
  for (const s of states) {
    for (const v of [...s.transform, s.alpha, s.strokeStart, s.strokeEnd, s.attachmentScale]) expect(Number.isFinite(v)).toBe(true);
    for (const st of s.subpathTransforms) for (const v of st.transform) expect(Number.isFinite(v)).toBe(true);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
  }
}

// ---- toAnimDrawing -------------------------------------------------------------------------

describe("toAnimDrawing", () => {
  it("slices each layer's commands and reads its animation fields", () => {
    const d = drawing();
    expect(d.layers).toHaveLength(3);
    expect(d.layers[1]!.path).toEqual({ ops: "MLLZ", argCounts: [2, 2, 2, 0], args: [0, 0, 50, 0, 50, 50] });
    expect(d.layers[2]!.path).toEqual({ ops: "ml", argCounts: [2, 2], args: [200, 200, 10, 10] });
    expect(d.layers[0]!.alwaysRotates).toBe(true);
    expect(d.layers[0]!.alwaysPulses).toBe(false);
    expect(d.layers[0]!.tags).toEqual(["_badge"]);
    expect(d.layers[1]!.strokeKeyframes).toHaveLength(1);
    expect(d.layers[2]!.variableThreshold).toBe(0.5);
    expect(d.drawReversesMotionGroups).toBe(true);
    expect(d.wiggleStyle).toBe("clockwise");
    expect(d.wiggleAngle).toBe(30);
    expect(d.rotatesClockwise).toBe(false);
    expect(d.viewBox).toEqual([0, 0, 20, 20]);
  });

  it("compacts motion groups ascending (07 §4.1)", () => {
    const d = drawing();
    expect(d.groupCount).toBe(2);
    expect(d.layers.map((l) => l.group)).toEqual([1, 0, 0]);
  });

  it("a layer is strokable when its family keyframes or attaches (08 §2)", () => {
    const d = drawing();
    expect(d.layers.map((l) => l.strokable)).toEqual([false, true, true]);
  });

  it("takes anchors and point size from the interpolated master", () => {
    const d = drawing();
    expect(d.metricCenter).toEqual([50, 50]);
    expect(d.rotationAnchor).toEqual([10, 20]);
    expect(d.pointSize).toBe(20);
  });

  it("without anchors: the bounding-box centre of the on-curve points, the viewBox height (07 §2.5, §2.6)", () => {
    const d = drawing({});
    expect(d.metricCenter).toEqual([105, 105]);
    expect(d.rotationAnchor).toEqual([105, 105]);
    expect(d.pointSize).toBe(20);
  });

  it("tolerates malformed anim fields", () => {
    const d = drawing({}, [layer([0, 5], 0, { alwaysRotates: "yes", strokeKeyframes: 7, tags: [1, "_slash"] })]);
    expect(d.layers[0]!.alwaysRotates).toBe(false);
    expect(d.layers[0]!.strokeKeyframes).toEqual([]);
    expect(d.layers[0]!.tags).toEqual(["_slash"]);
  });
});

// ---- the contract --------------------------------------------------------------------------

describe("sample: arguments", () => {
  it("an unregistered kind is a RangeError naming it", () => {
    const d = drawing();
    expect(() => sample(d, spec("sparkle" as EffectKind), 0)).toThrow(RangeError);
    expect(() => sample(d, spec("sparkle" as EffectKind), 0)).toThrow(/sparkle/);
    expect(() => duration(d, spec("sparkle" as EffectKind))).toThrow(/sparkle/);
  });

  it("speed ≤ 0 or non-finite, and a non-finite t, are RangeErrors (07 §6.4)", () => {
    const d = drawing();
    for (const speed of [0, -1, NaN, Infinity]) {
      const s = spec("variableColor", { speed });
      expect(() => sample(d, s, 0)).toThrow(RangeError);
      expect(() => duration(d, s)).toThrow(RangeError);
      expect(() => loopStart(d, s)).toThrow(RangeError);
    }
    for (const t of [NaN, Infinity, -Infinity]) expect(() => sample(d, spec("variableColor"), t)).toThrow(RangeError);
  });
});

describe("sample: once", () => {
  const plan = () =>
    register("bounce", () => ({
      tracks: [{ property: "scale", start: 0.5, from: 1, segments: [{ duration: 1, curve: 3, to: 2 }] }],
    }));

  it("t < 0 is the start state; t > duration the end state", () => {
    plan();
    const d = drawing();
    const s = spec("bounce");
    expect(duration(d, s)).toBe(1.5);
    expect(loopStart(d, s)).toBe(0);
    for (const st of sample(d, s, -5)) expect(st.transform).toEqual(ID);
    const end = sample(d, s, 1.5);
    expect(sample(d, s, 100)).toEqual(end);
    // scale 2 about the metric centre (50, 50)
    expect(end[0]!.transform).toEqual([2, 0, 0, 2, -50, -50]);
  });

  it("evaluates the curve between keyframes", () => {
    plan();
    const st = sample(drawing(), spec("bounce"), 1)[0]!;
    expect(st.transform[0]).toBeCloseTo(1 + curve(3)(0.5), 12);
  });

  it("speed divides durations and multiplies time", () => {
    plan();
    const d = drawing();
    expect(duration(d, spec("bounce", { speed: 2 }))).toBe(0.75);
    expect(sample(d, spec("bounce", { speed: 2 }), 0.5)).toEqual(sample(d, spec("bounce"), 1));
    expect(sample(d, spec("bounce", { speed: 0.5 }), 2)).toEqual(sample(d, spec("bounce"), 1));
  });

  it("a plan with no timed segment lasts 1.0 (07 §6.3)", () => {
    register("pulse", () => ({ tracks: [] }));
    expect(duration(drawing(), spec("pulse"))).toBe(1);
    expect(duration(drawing(), spec("pulse", { speed: 4 }))).toBe(0.25);
  });

  it("a whole-clock warp remaps time through its curve (07 §7.8 .individually)", () => {
    register("draw", () => ({
      tracks: [{ property: "alpha", start: 0, from: 0, segments: [{ duration: 2, curve: 0, to: 1 }] }],
      timeSpan: 2,
      timeCurve: 17,
    }));
    const st = sample(drawing(), spec("draw"), 0.5)[0]!;
    expect(st.alpha).toBeCloseTo((2 * curve(17)(0.25)) / 2, 12);
  });
});

describe("sample: continuous", () => {
  const plan = () =>
    register("rotate", () => ({
      tracks: [{ property: "symbolRotation", start: 0, from: 0, segments: [{ duration: 0.5, curve: 1, to: 1 }] }],
      loop: {
        period: 2,
        tracks: [{ property: "symbolRotation", start: 0, from: 1, segments: [{ duration: 2, curve: 12, to: 1 + 2 * Math.PI }] }],
      },
      groupDelay: [0, 0.3],
    }));

  it("duration is the loop period and loopStart the intro plus the largest delay (07 §6.3)", () => {
    plan();
    const d = drawing();
    const s = spec("rotate", { repeat: "continuous" });
    expect(duration(d, s)).toBe(2);
    expect(loopStart(d, s)).toBeCloseTo(0.8, 12);
    expect(duration(d, { ...s, speed: 4 })).toBe(0.5);
    expect(loopStart(d, { ...s, speed: 4 })).toBeCloseTo(0.2, 12);
  });

  it("repeats with the period from loopStart on", () => {
    plan();
    const d = drawing();
    const s = spec("rotate", { repeat: "continuous" });
    for (const t of [0.8, 1.1, 2.37, 5]) {
      const a = sample(d, s, t);
      const b = sample(d, s, t + 2);
      const c = sample(d, s, t + 6);
      for (let i = 0; i < a.length; i++) {
        for (let k = 0; k < 6; k++) {
          expect(b[i]!.transform[k]).toBeCloseTo(a[i]!.transform[k]!, 9);
          expect(c[i]!.transform[k]).toBeCloseTo(a[i]!.transform[k]!, 9);
        }
      }
    }
  });

  it("each group runs on its delayed clock and holds the intro's first value before it", () => {
    plan();
    const d = drawing();
    const s = spec("rotate", { repeat: "continuous" });
    const at = sample(d, s, 0.3);
    // group 0 (layers 1, 2) is 0.3 s into the intro; group 1 (layer 0) is held at its start
    expect(at[0]!.transform).toEqual(ID);
    const turn = curve(1)(0.6);
    expect(at[1]!.transform[0]).toBeCloseTo(Math.cos(turn), 12);
    expect(at[1]!.transform[1]).toBeCloseTo(Math.sin(turn), 12);
    // group 1 at t = 0.8 matches group 0 at t = 0.5
    const late = sample(d, s, 0.8)[0]!.transform;
    const early = sample(d, s, 0.5)[1]!.transform;
    for (let k = 0; k < 6; k++) expect(late[k]).toBeCloseTo(early[k]!, 12);
  });

  it("not by layer: one group, no delay", () => {
    plan();
    const d = drawing();
    const s = spec("rotate", { repeat: "continuous", byLayer: false });
    const at = sample(d, s, 0.3);
    expect(at[0]!.transform).toEqual(at[1]!.transform);
    expect(loopStart(d, s)).toBeCloseTo(0.5, 12);
  });
});

// ---- applying properties (07 §2.3, §2.5) -------------------------------------------------

describe("sample: properties", () => {
  const constant = (tracks: Array<Record<string, unknown>>) =>
    register("wiggle", () => ({ tracks: tracks.map((t) => ({ start: 0, segments: [], ...t })) as never }));

  it("composes badge scale, layer rotation, scale and symbol rotation in Apple's order", () => {
    constant([
      { property: "scale", from: 2 },
      { property: "layerRotation", from: Math.PI / 2 },
    ]);
    const m = sample(drawing(), spec("wiggle"), 0)[0]!.transform;
    // the anchor (10, 20) is fixed by the turn, then scaled about (50, 50)
    const [ax, ay] = apply(m, 10, 20);
    expect(ax).toBeCloseTo(50 + 2 * (10 - 50), 9);
    expect(ay).toBeCloseTo(50 + 2 * (20 - 50), 9);
    // a point one unit right of the anchor turns clockwise (y down) to one unit below it
    const [px, py] = apply(m, 11, 20);
    expect(px).toBeCloseTo(ax, 9);
    expect(py).toBeCloseTo(ay + 2, 9);
  });

  it("symbol rotation turns about the metric centre", () => {
    constant([{ property: "symbolRotation", from: Math.PI }]);
    const m = sample(drawing(), spec("wiggle"), 0)[0]!.transform;
    const [x, y] = apply(m, 60, 50);
    expect(x).toBeCloseTo(40, 9);
    expect(y).toBeCloseTo(50, 9);
  });

  it("badge scale is about the centre of the _badge layers' bounds", () => {
    constant([{ property: "scaleBadge", from: 0.5 }]);
    const m = sample(drawing(), spec("wiggle"), 0)[0]!.transform;
    expect(apply(m, 50, 50)).toEqual([50, 50]);
    expect(apply(m, 100, 100)).toEqual([75, 75]);
  });

  it("scale-interpolant moves from s to k", () => {
    constant([{ property: "scaleInterpolant", from: 0.5, interp: [1, 1.25] }]);
    expect(sample(drawing(), spec("wiggle"), 0)[0]!.transform[0]).toBeCloseTo(1.125, 12);
  });

  it("translation is v · point size along dir in output space, mapped into path space (07 §2.6)", () => {
    constant([{ property: "translation", from: 0.5, dir: [0, 1] }]);
    const m = sample(drawing(), spec("wiggle"), 0)[0]!.transform;
    // 0.5 · 20 viewBox units, through the inverse of scale 0.1 → 100 path units down
    expect(m[4]).toBeCloseTo(0, 12);
    expect(m[5]).toBeCloseTo(100, 12);
  });

  it("alphas multiply and clamp; clip-alpha ≤ 0 hides", () => {
    constant([
      { property: "alpha", from: 0.5 },
      { property: "pulseAlpha", from: 0 },
    ]);
    // pulse floor 0.3 (07 §7.2)
    expect(sample(drawing(), spec("wiggle"), 0)[0]!.alpha).toBeCloseTo(0.5 * Math.fround(0.3), 12);
    cleanups.pop()!();
    constant([{ property: "alpha", from: 3 }]);
    expect(sample(drawing(), spec("wiggle"), 0)[0]!.alpha).toBe(1);
    cleanups.pop()!();
    constant([{ property: "clipAlpha", from: 0 }]);
    const st = sample(drawing(), spec("wiggle"), 0)[0]!;
    expect(st.visible).toBe(false);
    expect(st.alpha).toBe(0);
  });

  it("stroke-end is the clip end on a strokable layer and an alpha on any other (07 §2.3)", () => {
    constant([{ property: "strokeEnd", from: 0.25 }, { property: "strokeStart", from: 0.1 }]);
    const [a, b] = sample(drawing(), spec("wiggle"), 0);
    expect(a!.strokeClip).toBe(false);
    expect(a!.alpha).toBeCloseTo(0.25 * 0.9, 12);
    expect(b!.strokeClip).toBe(true);
    expect(b!.strokeStart).toBe(0.1);
    expect(b!.strokeEnd).toBe(0.25);
    expect(b!.alpha).toBe(1);
  });

  it("filters, group and layer indices choose the layers a track reaches (07 §2.2)", () => {
    constant([
      { property: "alpha", from: 0.5, filter: FILTER.alwaysRotates },
      { property: "scale", from: 2, group: 0 },
      { property: "attachmentScale", from: 0.5, layer: 2 },
    ]);
    const [a, b, c] = sample(drawing(), spec("wiggle"), 0);
    expect([a!.alpha, b!.alpha, c!.alpha]).toEqual([0.5, 1, 1]);
    expect([a!.transform[0], b!.transform[0], c!.transform[0]]).toEqual([1, 2, 2]);
    expect([a!.attachmentScale, b!.attachmentScale, c!.attachmentScale]).toEqual([1, 1, 0.5]);
  });

  it("an eraser in the rendering mode is excluded by the alwaysPulses filter", () => {
    const layers = [
      layer([0, 5], 0, { alwaysPulses: true }, { modes: { ...modes(), hierarchical: { paint: { kind: "tint" }, opacity: 1, clearBehind: true } } }),
    ];
    constant([{ property: "alpha", from: 0.5, filter: FILTER.alwaysPulses }]);
    expect(sample(drawing({}, layers), spec("wiggle"), 0)[0]!.alpha).toBe(0.5);
    expect(sample(drawing({}, layers), spec("wiggle", { renderingMode: "hierarchical" }), 0)[0]!.alpha).toBe(1);
  });

  it("identity state by default", () => {
    constant([]);
    const st = sample(drawing(), spec("wiggle"), 0)[0]!;
    expect(st).toEqual({
      transform: ID,
      alpha: 1,
      visible: true,
      strokeStart: 0,
      strokeEnd: 1,
      strokeClip: false,
      attachmentScale: 1,
      subpathTransforms: [],
    });
  });
});

// ---- static Variable Color (07 §9.2, §9.3) ----------------------------------------------

describe("variableColor (static)", () => {
  const vc = (value: number | undefined, over: Partial<VariantData> = {}, layers?: LayerData[]) => {
    const v = { ...variant(ANCHORED, layers), ...over };
    return sample(toAnimDrawing(v, interpolate(v, 4)), spec("variableColor", { variableValue: value }), 0);
  };

  it("hard cut: alpha = v ≥ θ ? 1 : 0.3 (07 §9.2); layers without θ stay at full alpha", () => {
    expect(vc(0.49).map((s) => [s.alpha, s.visible])).toEqual([[1, true], [1, true], [Math.fround(0.3), true]]);
    expect(vc(0.5)[2]!.alpha).toBe(1);
  });

  it("band: a 0.06 half-width ramp around θ from 0.3 to 1 (vcContinuous)", () => {
    expect(vc(0.5, { vcContinuous: true })[2]!.alpha).toBeCloseTo(0.65, 7);
    expect(vc(0.47, { vcContinuous: true })[2]!.alpha).toBeCloseTo(0.475, 7);
    expect(vc(0.44, { vcContinuous: true })[2]!.alpha).toBe(Math.fround(0.3));
    expect(vc(0.44, { vcContinuous: true })[2]!.visible).toBe(true);
    expect(vc(0.56, { vcContinuous: true })[2]!.alpha).toBe(1);
  });

  it("a non-finite or missing value reads 0; the value is clamped", () => {
    expect(vc(NaN)[2]!.alpha).toBe(Math.fround(0.3));
    expect(vc(undefined)[2]!.alpha).toBe(Math.fround(0.3));
    expect(vc(7)[2]!.alpha).toBe(1);
  });

  it("draw mode: the band's fraction drives the stroke end, or the alpha of a non-strokable layer", () => {
    const layers = [
      layer([0, 5], 4, {}),
      layer([5, 9], 1, { strokeKeyframes: [{ flags: 0, progress: 0, d0: 0, d1: 0 }], variableDraw: [0.2, 0.4] }),
      layer([9, 11], 4, { variableDraw: [0.5, 0] }),
    ];
    const st = vc(0.4, { variableValueMode: "draw" }, layers);
    // layer 0: group 1 of 2 → band (0.5, 0.5) → fraction 0 → hidden
    expect(st[0]!.alpha).toBe(0);
    expect(st[0]!.visible).toBe(false);
    // layer 1: (0.4 − 0.2) / 0.4
    expect(st[1]!.strokeClip).toBe(true);
    expect(st[1]!.strokeEnd).toBeCloseTo(0.5, 12);
    // layer 2: length 0 → hard cut at 0.5
    expect(st[2]!.alpha).toBe(0);
    expect(vc(0.5, { variableValueMode: "draw" }, layers)[2]!.alpha).toBe(1);
    expect(vc(0.75, { variableValueMode: "draw" }, layers)[0]!.alpha).toBeCloseTo(0.5, 12);
  });

  it("is static: same state at every t", () => {
    const d = drawing();
    const s = spec("variableColor", { variableValue: 0.7 });
    expect(sample(d, s, 0)).toEqual(sample(d, s, 3));
    expect(duration(d, s)).toBe(1);
  });
});

// ---- Review Focus 2: never NaN -----------------------------------------------------------

describe("no NaN for a sweep (Review Focus 2)", () => {
  it("every state is finite over t, speed and repeat, with and without anchors", () => {
    register("bounce", () => ({
      tracks: [
        { property: "scale", start: 0, from: 1, segments: [{ duration: 0, curve: 0, to: 0.5 }, { duration: 0.3, curve: 5, to: 1.25 }] },
        { property: "translation", start: 0.1, from: 0, dir: [0.6, 0.8], segments: [{ duration: 0.2, curve: 9, to: 0.06 }] },
        { property: "layerRotation", start: 0, from: 0, segments: [{ duration: 0.4, curve: 41, to: 6.283 }] },
        { property: "clipAlpha", start: 0, from: 0, segments: [{ duration: 0.2, curve: 14, to: 1 }] },
        { property: "strokeEnd", start: 0, from: 0, segments: [{ duration: 0.2, curve: 17, to: 1 }] },
      ],
      loop: { period: 0.4, tracks: [{ property: "scale", start: 0, from: 0.95, segments: [{ duration: 0.4, curve: 3, to: 1.05 }] }] },
      groupDelay: [0, 0.05],
    }));
    const empty = drawing({}, []);
    for (const d of [drawing(), drawing({}), empty]) {
      for (const kind of ["bounce", "variableColor"] as EffectKind[]) {
        for (const repeat of ["once", "continuous"] as const) {
          for (const speed of [0.25, 1, 3.7]) {
            const s = spec(kind, { repeat, speed, variableValue: 0.6 });
            expect(Number.isFinite(duration(d, s))).toBe(true);
            expect(Number.isFinite(loopStart(d, s))).toBe(true);
            for (let t = -1; t <= 5; t += 0.037) expectFinite(sample(d, s, t));
          }
        }
      }
      expect(sample(empty, spec("bounce"), 0)).toEqual([]);
    }
  });
});

// ---- fix round 1 -------------------------------------------------------------------------

describe("spec", () => {
  it("defaults to the light appearance", () => {
    expect(defaultSpec("pulse").appearance).toBe("light");
  });

  it("the plan key changes with every field but speed", () => {
    const base: Spec = { ...defaultSpec("bounce"), variableValue: 0.5 };
    const alt: { [K in keyof Spec]: Spec[K] } = {
      kind: "wiggle",
      repeat: "continuous",
      speed: 3,
      byLayer: false,
      reversed: true,
      variableValue: 0.7,
      direction: "down",
      breathePlain: true,
      replaceStyle: "offUp",
      replaceHalf: "in",
      drawIndividually: true,
      drawReversedOrder: true,
      renderingMode: "hierarchical",
      appearance: "dark",
      rotateDirection: "counterClockwise",
    };
    for (const k of Object.keys(alt) as Array<keyof Spec>) {
      const changed = { ...base, [k]: alt[k] } as Spec;
      if (k === "speed") expect(specKey(changed)).toBe(specKey(base));
      else expect(specKey(changed), k).not.toBe(specKey(base));
    }
    // every Spec field is covered by `alt`
    expect(Object.keys(base).sort()).toEqual(Object.keys(alt).sort());
  });
});

describe("sample: robustness", () => {
  it("an effect time that overflows is a RangeError", () => {
    register("bounce", () => ({ tracks: [] }));
    expect(() => sample(drawing(), spec("bounce", { speed: 10 }), 1e308)).toThrow(RangeError);
  });

  it("a non-finite transform component is a RangeError naming it", () => {
    register("bounce", () => ({ tracks: [{ property: "scale", start: 0, from: NaN, segments: [] }] }));
    expect(() => sample(drawing(), spec("bounce"), 0)).toThrow(/scale/);
    cleanups.pop()!();
    register("bounce", () => ({ tracks: [{ property: "layerRotation", start: 0, from: Infinity, segments: [] }] }));
    expect(() => sample(drawing(), spec("bounce"), 0)).toThrow(RangeError);
    expect(() => sample(drawing(), spec("bounce"), 0)).toThrow(/layerTurn/);
  });
});

describe("pulse hooks (07 §7.2, §2.7)", () => {
  const roles = (pulses: boolean) => [
    layer([0, 5], 0, { alwaysPulses: pulses }, { role: "primary" }),
    layer([5, 9], 1, { alwaysPulses: pulses }, { role: "secondary" }),
    layer([9, 11], 2, { alwaysPulses: pulses }, { role: "tertiary" }),
  ];
  const run = (over: Partial<Spec>, pulses = true) => {
    register("pulse", (d, s) => ({
      tracks: [{ property: "pulseAlpha", start: 0, from: 0, segments: [], filter: FILTER.alwaysPulses }],
      ...pulseHooks(d, s),
    }));
    const out = sample(drawing({}, roles(pulses)), spec("pulse", { renderingMode: "hierarchical", ...over }), 0).map((s) => s.alpha);
    cleanups.pop()!();
    return out;
  };

  it("hierarchical, by layer, with always-pulses layers: the neighbour level's opacity over the own", () => {
    const light = run({});
    expect(light[0]).toBeCloseTo(0.5, 12); // 0.5 / 1.0
    expect(light[1]).toBeCloseTo(2, 12); // 1.0 / 0.5, capped at 1 / 0.5
    expect(light[2]).toBeCloseTo(0.5 / 0.18, 12); // cap 1 / 0.18
    const dark = run({ appearance: "dark" });
    expect(dark[2]).toBeCloseTo(2, 12); // 0.5 / 0.25
  });

  it("otherwise the default floor 0.3", () => {
    const f = Math.fround(0.3);
    expect(run({ renderingMode: "monochrome" })).toEqual([f, f, f]);
    expect(run({ byLayer: false })).toEqual([f, f, f]);
    // no always-pulses layer: the filter admits none, nothing dims
    expect(run({}, false)).toEqual([1, 1, 1]);
  });
});
