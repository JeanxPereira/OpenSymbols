import { describe, expect, it } from "vitest";
import { interpolate, type LayerData, type RenderMode, type VariantData } from "@opensymbols/core";
import {
  defaultSpec,
  duration,
  replaceDuration,
  replacePair,
  replaceSubtype,
  sample,
  toAnimDrawing,
  type AnimDrawing,
  type LayerState,
  type Spec,
} from "../src/index.js";
import { curve } from "../src/curves.js";

// ---- fixture -------------------------------------------------------------------------------

const f = Math.fround;
const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

interface L {
  group?: number;
  tags?: string[];
  /** Give the layer a stroke keyframe (strokable, 08 §2) with this stroke length in point sizes. */
  stroke?: number;
  eraser?: boolean;
}

/** One 0..100 square per layer; metric centre (50, 50), point size 20, transform ×0.1. */
function drawing(spec: L[], name = "sym", pointSize = 20): AnimDrawing {
  const ops = "MLLLZ".repeat(spec.length);
  const argCounts = spec.flatMap(() => [2, 2, 2, 2, 0]);
  const args = spec.flatMap(() => [0, 0, 100, 0, 100, 100, 0, 100]);
  const layers: LayerData[] = spec.map((l, i) => ({
    cmd: [i * 5, i * 5 + 5],
    role: "primary",
    modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: l.eraser === true }])) as LayerData["modes"],
    motionGroup: l.group ?? 0,
    anim: {
      tags: l.tags ?? [],
      ...(l.stroke !== undefined ? { strokeKeyframes: [{ flags: 0, progress: 0, d0: 0, d1: 0 }] } : {}),
    },
  }));
  const v: VariantData = {
    ops,
    argCounts,
    masters: {
      4: {
        args,
        viewBox: [0, 0, 20, 20],
        transform: [0.1, 0, 0, 0.1, 0, 0],
        metrics: { referencePointSize: pointSize, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 },
        metricCenter: [50, 50],
      },
    },
    layers,
    variableValueMode: "color",
    vcContinuous: false,
  };
  const d = toAnimDrawing(v, interpolate(v, 4), name);
  // 08 §3: the stroke length is Task 6's; the fixture states it directly.
  spec.forEach((l, i) => {
    if (l.stroke !== undefined) d.layers[i]!.strokeLength = l.stroke;
  });
  return d;
}

const groups = (n: number): L[] => Array.from({ length: n }, (_, i) => ({ group: (i + 1) * 10 }));
const spec = (over: Partial<Spec> = {}): Spec => ({ ...defaultSpec("replace"), ...over });
const magic = (over: Partial<Spec> = {}): Spec => ({ ...defaultSpec("magicReplace"), ...over });
const scaleOf = (s: LayerState) => Math.hypot(s.transform[0], s.transform[1]);
const IDENTITY = [1, 0, 0, 1, 0, 0];

function expectSane(states: LayerState[]) {
  for (const s of states) {
    for (const v of [...s.transform, s.alpha, s.strokeStart, s.strokeEnd, s.attachmentScale]) expect(Number.isFinite(v)).toBe(true);
    expect(s.alpha).toBeGreaterThanOrEqual(0);
    expect(s.alpha).toBeLessThanOrEqual(1);
  }
}

// float32 constants of 07, as printed there
const STEP = f(0.05000000074505806); // §4.2 ceiling (Replace row)
const S0_UPUP = f(0.1666666567325592); // §7.9
const D333 = f(0.3330000042915344); // §7.9 upUp in
const F083 = f(0.08299999684); // §7.10
const THIRTIETH = f(1 / 30); // §7.8 plateau, 0.03333333507180214

/** 07 §7.8: a strokable layer's Draw duration from its stroke length. */
const drawDur = (len: number) => {
  const x = Math.min(Math.max(len * f(0.17182131111621857), 0), 1);
  return x * (2 - x) * f(0.8666666746139526) + f(0.13333334028720856);
};

// ---- plain Replace (07 §7.9) ---------------------------------------------------------------

describe("replace, plain style 0 (07 §7.9)", () => {
  const s = spec({ replaceStyle: "plain" });
  const a = drawing(groups(2));
  const b = drawing(groups(3));

  it("out fades 1 → 0.2 over 0.25 on curve 1, then is gone; no scale", () => {
    const at = (t: number) => replacePair(a, b, s, t).out;
    expect(at(0).map((x) => x.alpha)).toEqual([1, 1]);
    expect(at(0.125)[0]!.alpha).toBeCloseTo(1 - 0.8 * curve(1)(0.5), 6);
    expect(at(0.2499)[1]!.alpha).toBeGreaterThan(0.2);
    expect(at(0.25).every((x) => !x.visible && x.alpha === 0)).toBe(true);
    for (const t of [0, 0.1, 0.3]) for (const x of at(t)) expect(x.transform).toEqual(IDENTITY);
  });

  it("in is hidden until s0 = 0.25, jumps to 0.2, fades to 1 at 0.5", () => {
    const at = (t: number) => replacePair(a, b, s, t).in;
    expect(at(0.2).every((x) => !x.visible)).toBe(true);
    expect(at(0.25)[0]!.alpha).toBeCloseTo(f(0.20000000298023224), 6);
    expect(at(0.375)[2]!.alpha).toBeCloseTo(f(0.2) + (1 - f(0.2)) * curve(1)(0.5), 6);
    expect(at(0.5).map((x) => x.alpha)).toEqual([1, 1, 1]);
    expect(replaceDuration(a, b, s)).toBeCloseTo(0.5, 6);
  });
});

describe("replace, downUp style 1 (07 §7.9, §4.4)", () => {
  it("the default style", () => {
    expect(defaultSpec("replace").replaceStyle).toBe("downUp");
  });

  it("one group: out 1 → 0.5 on curve 19 to 0.25, then gone; in 0.5 → 1 on curve 20 from 0.25", () => {
    const a = drawing(groups(1));
    const b = drawing(groups(1));
    const s = spec({ byLayer: false });
    const out = (t: number) => replacePair(a, b, s, t).out[0]!;
    const inn = (t: number) => replacePair(a, b, s, t).in[0]!;
    expect(scaleOf(out(0.1))).toBeCloseTo(1 - 0.5 * curve(19)(0.1 / 0.25), 6);
    expect(out(0.1).alpha).toBe(1);
    expect(out(0.25).visible).toBe(false);
    expect(inn(0.24).visible).toBe(false);
    expect(inn(0.25).alpha).toBe(1);
    expect(scaleOf(inn(0.25))).toBeCloseTo(0.5, 6);
    expect(scaleOf(inn(0.35))).toBeCloseTo(0.5 + 0.5 * curve(20)(0.1 / 0.25), 6);
    expect(scaleOf(inn(0.5))).toBeCloseTo(1, 9);
    expect(replaceDuration(a, b, s)).toBeCloseTo(0.5, 6);
    expect(duration(a, { ...s, replaceHalf: "out" })).toBeCloseTo(0.5, 6);
  });

  it("by layer: out descending, all at 0.5 by 0.25; in all start at 0.25, group i ends at 0.5 − step·(n−1−i)", () => {
    const a = drawing(groups(3));
    const b = drawing(groups(3));
    const s = spec();
    const out = (t: number) => replacePair(a, b, s, t).out.map(scaleOf);
    // group 2 starts at 0, group 1 at step, group 0 at 2·step
    expect(out(STEP)[2]).toBeLessThan(1);
    expect(out(STEP)[1]).toBe(1);
    expect(out(2 * STEP)[0]).toBe(1);
    expect(out(2 * STEP + 0.05)[0]!).toBeCloseTo(1 - 0.5 * curve(19)(0.05 / (0.25 - 2 * STEP)), 6);
    expect(out(0.2499)[0]).toBeCloseTo(0.5, 2);
    const inn = (t: number) => replacePair(a, b, s, t).in.map(scaleOf);
    expect(inn(0.25 + 0.25 - 2 * STEP)[0]).toBeCloseTo(1, 9);
    expect(inn(0.25 + 0.25 - 2 * STEP)[2]).toBeLessThan(1);
    expect(inn(0.25 + 0.1)[1]).toBeCloseTo(0.5 + 0.5 * curve(20)(0.1 / (0.25 - STEP)), 6);
    expect(inn(0.5)).toEqual([1, 1, 1].map((v) => expect.closeTo(v, 9)));
  });
});

describe("replace, upUp style 2 (07 §7.9)", () => {
  it("out: scale 1 → 1.25 and alpha 1 → 0 on curve 21; in from 0.1667: 0.4 → 1 and clip 0 → 1 on curve 22 over 0.333", () => {
    const a = drawing(groups(1));
    const b = drawing(groups(1));
    const s = spec({ replaceStyle: "upUp" });
    const pair = (t: number) => replacePair(a, b, s, t);
    const u = curve(21)(0.1 / 0.25);
    expect(scaleOf(pair(0.1).out[0]!)).toBeCloseTo(1 + 0.25 * u, 6);
    expect(pair(0.1).out[0]!.alpha).toBeCloseTo(1 - u, 6);
    expect(pair(0.25).out[0]!.visible).toBe(false);
    expect(pair(S0_UPUP - 0.001).in[0]!.visible).toBe(false);
    const v = curve(22)(0.1 / D333);
    expect(scaleOf(pair(S0_UPUP + 0.1).in[0]!)).toBeCloseTo(f(0.4000000059604645) + (1 - f(0.4000000059604645)) * v, 6);
    expect(pair(S0_UPUP + 0.1).in[0]!.alpha).toBeCloseTo(v, 6);
    expect(scaleOf(pair(S0_UPUP + D333).in[0]!)).toBeCloseTo(1, 9);
    expect(replaceDuration(a, b, s)).toBeCloseTo(0.5, 6);
  });

  it("by layer: out every group from 0, group i lasting 0.25 − step·(n−1−i); in group i from s0 + step·i", () => {
    const a = drawing(groups(3));
    const b = drawing(groups(3));
    const s = spec({ replaceStyle: "upUp" });
    const out = replacePair(a, b, s, 0.25 - 2 * STEP).out;
    expect(scaleOf(out[0]!)).toBeCloseTo(1.25, 9);
    expect(scaleOf(out[2]!)).toBeLessThan(1.25);
    const inn = replacePair(a, b, s, S0_UPUP + STEP).in;
    expect(inn[0]!.visible).toBe(true);
    expect(inn[1]!.visible).toBe(false); // starts exactly now: clip-alpha 0
    expect(inn[2]!.visible).toBe(false);
  });
});

describe("replace, offUp style 3 (07 §7.9)", () => {
  it("out is gone at once; in from 0: 0.5 → 1 on curve 23, clip 0 → 1 on curve 24; total 0.25", () => {
    const a = drawing(groups(2));
    const b = drawing(groups(1));
    const s = spec({ replaceStyle: "offUp" });
    for (const t of [-1, 0, 0.1, 1]) expect(replacePair(a, b, s, t).out.every((x) => !x.visible)).toBe(true);
    const inn = replacePair(a, b, s, 0.1).in[0]!;
    expect(scaleOf(inn)).toBeCloseTo(0.5 + 0.5 * curve(23)(0.1 / 0.25), 6);
    expect(inn.alpha).toBeCloseTo(curve(24)(0.1 / 0.25), 6);
    expect(replaceDuration(a, b, s)).toBeCloseTo(0.25, 6);
  });
});

describe("replace: the halves on their own", () => {
  it("sample with replaceHalf plays the same half replacePair does", () => {
    const a = drawing(groups(3));
    const b = drawing(groups(2));
    for (const replaceStyle of ["plain", "downUp", "upUp", "offUp"] as const) {
      const s = spec({ replaceStyle });
      for (const t of [0, 0.1, 0.26, 0.4]) {
        const p = replacePair(a, b, s, t);
        expect(p.out).toEqual(sample(a, { ...s, replaceHalf: "out" }, t));
        expect(p.in).toEqual(sample(b, { ...s, replaceHalf: "in" }, t));
      }
    }
  });

  it("speed divides the pair's duration", () => {
    const a = drawing(groups(1));
    expect(replaceDuration(a, a, spec({ speed: 2 }))).toBeCloseTo(0.25, 6);
  });
});

// ---- Review Focus 4: different layer counts, no shared tags ---------------------------------

describe("replace between different drawings (Review Focus 4)", () => {
  const one = drawing([{ tags: ["a"] }], "a");
  const many = drawing([{ group: 1, tags: ["b"] }, { group: 2, tags: ["b", "_badge"] }, { group: 2, stroke: 3 }, { group: 9, eraser: true }], "b");
  const empty = drawing([], "e");

  it("never throws; each half is indexed like its own drawing; nothing NaN", () => {
    for (const kind of ["replace", "magicReplace"] as const) {
      for (const replaceStyle of ["plain", "downUp", "upUp", "offUp"] as const) {
        for (const byLayer of [true, false]) {
          const s: Spec = { ...defaultSpec(kind), replaceStyle, byLayer };
          for (const [x, y] of [
            [one, many],
            [many, one],
            [empty, many],
            [many, empty],
            [empty, empty],
          ] as const) {
            expect(() => replaceDuration(x, y, s)).not.toThrow();
            for (const t of [-0.1, 0, 0.1, 0.25, 0.3, 0.5, 1.2, 10]) {
              const p = replacePair(x, y, s, t);
              expect(p.out).toHaveLength(x.layers.length);
              expect(p.in).toHaveLength(y.layers.length);
              expectSane(p.out);
              expectSane(p.in);
            }
          }
        }
      }
    }
  });

  it("magic replace with no shared tags and nothing strokable plays the plain Replace pair", () => {
    const a = drawing([{ tags: ["x"] }, { tags: ["x"] }], "x");
    const b = drawing([{ tags: ["y"] }], "y");
    expect(replaceSubtype(a, b)).toBeUndefined();
    for (const replaceStyle of ["plain", "downUp", "upUp", "offUp"] as const) {
      for (const t of [0, 0.1, 0.3, 0.45]) {
        expect(replacePair(a, b, magic({ replaceStyle }), t)).toEqual(replacePair(a, b, spec({ replaceStyle }), t));
      }
    }
  });

  it("sample of a single magicReplace drawing is its plain half", () => {
    const a = drawing(groups(2));
    expect(sample(a, magic({ replaceHalf: "in" }), 0.3)).toEqual(sample(a, spec({ replaceHalf: "in" }), 0.3));
  });
});

// ---- Magic Replace: the subtype (07 §7.10) ---------------------------------------------------

describe("magic replace: infer the subtype (07 §7.10)", () => {
  const wifi = drawing([{ tags: ["wifi"] }], "wifi");
  const wifiSlash = drawing([{ tags: ["wifi", "wifi.slash"] }, { tags: ["_slash", "wifi.slash"] }], "wifi.slash");
  const plain = drawing([{ tags: ["bell"] }], "bell");
  const badged = drawing([{ tags: ["bell"] }, { tags: ["_badge"] }], "bell.badge");
  const badgedOther = drawing([{ tags: ["bell"] }, { tags: ["_badge", "dot.other"] }], "bell.badge.other");

  it("slash add 0 and remove 1, dropping the symbols' own names", () => {
    expect(replaceSubtype(wifi, wifiSlash)).toBe(0);
    expect(replaceSubtype(wifiSlash, wifi)).toBe(1);
  });

  it("slash with other tags differing outside the slash: not a slash subtype", () => {
    const other = drawing([{ tags: ["speaker", "wave"] }], "speaker");
    expect(replaceSubtype(other, wifiSlash)).toBeUndefined();
  });

  it("badge add 2, remove 3, move 4", () => {
    expect(replaceSubtype(plain, badged)).toBe(2);
    expect(replaceSubtype(badged, plain)).toBe(3);
    expect(replaceSubtype(badged, badgedOther)).toBe(4);
    expect(replaceSubtype(badged, badged)).toBeUndefined();
  });

  it("draw: more than one common enclosure tag 7; exactly one, not an enclosure tag, 6; else strokable 5", () => {
    const upCircle = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["arrow.up"], stroke: 2 }], "arrow.up.circle");
    const downCircle = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["arrow.down"], stroke: 2 }], "arrow.down.circle");
    expect(replaceSubtype(upCircle, downCircle)).toBe(7);
    const check = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["checkmark"], stroke: 1 }], "checkmark.circle");
    const checkFill = drawing([{ tags: ["_enclosure.fill", "circle"] }, { tags: ["checkmark"] }], "checkmark.circle.fill");
    expect(replaceSubtype(check, checkFill)).toBe(6);
    const plus = drawing([{ tags: ["plus"], stroke: 1 }], "plus");
    const minus = drawing([{ tags: ["minus"], stroke: 1 }], "minus");
    expect(replaceSubtype(plus, minus)).toBe(5);
    // an enclosure alone, nothing strokable, no common tags: nothing
    const sq = drawing([{ tags: ["_enclosure.fill", "square"] }], "square");
    const ring = drawing([{ tags: ["_enclosure.stroke", "circle"] }], "circle");
    expect(replaceSubtype(sq, ring)).toBeUndefined();
  });

  it("the model has no render-size precondition (step 1 holds by construction)", () => {
    const a = drawing([{ tags: ["wifi"] }], "wifi", 20);
    const b = drawing([{ tags: ["wifi", "wifi.slash"] }, { tags: ["_slash", "wifi.slash"] }], "wifi.slash", 24);
    expect(replaceSubtype(a, b)).toBe(0);
  });

  it("catalog-like tags carrying the symbol names: names passed to toAnimDrawing make slash and badge match", () => {
    // wifi's layers are {wifi}; wifi.slash's {wifi, wifi.slash} and {_slash, wifi.slash} (07 §7.10 [CAR])
    const wifiL: L[] = [{ tags: ["wifi"] }, { tags: ["wifi"] }];
    const slashL: L[] = [{ tags: ["wifi", "wifi.slash"] }, { tags: ["_slash", "wifi.slash"] }];
    expect(replaceSubtype(drawing(wifiL, "wifi"), drawing(slashL, "wifi.slash"))).toBe(0);
    expect(replaceSubtype(drawing(slashL, "wifi.slash"), drawing(wifiL, "wifi"))).toBe(1);
    // speaker.slash.rtl extends its own name: dropped
    const spk: L[] = [{ tags: ["speaker"] }];
    const spkSlash: L[] = [{ tags: ["speaker", "speaker.slash.rtl"] }, { tags: ["_slash", "speaker.slash.rtl"] }];
    expect(replaceSubtype(drawing(spk, "speaker.rtl"), drawing(spkSlash, "speaker.slash"))).toBe(0);
    // badge: bell → bell.badge, the bell tag on both
    const bellL: L[] = [{ tags: ["bell"] }];
    const bellBadgeL: L[] = [{ tags: ["bell", "bell.badge"] }, { tags: ["_badge", "bell.badge"] }];
    expect(replaceSubtype(drawing(bellL, "bell"), drawing(bellBadgeL, "bell.badge"))).toBe(2);
    expect(replaceSubtype(drawing(bellBadgeL, "bell.badge"), drawing(bellL, "bell"))).toBe(3);
    // without names, the name tags never agree across the pair
    const anon = (l: L[]) => {
      const d = drawing(l);
      delete d.name;
      return d;
    };
    expect(replaceSubtype(anon(wifiL), anon(slashL))).toBeUndefined();
  });
});

// ---- Magic Replace: slash and badge tables (07 §7.10) ------------------------------------------

describe("magic replace: slash and badge", () => {
  const wifi = drawing([{ tags: ["wifi"] }, { tags: ["wifi"] }], "wifi");
  const wifiSlash = drawing([{ tags: ["wifi", "wifi.slash"] }, { tags: ["_slash", "wifi.slash"], stroke: 1 }], "wifi.slash");

  it("slash add: the destination's slash draws 0 → 1.08 → 1 (stroke-end); source non-slash hidden; 0.6667 s", () => {
    const s = magic();
    const t = f(0.3333333432674408) / 2;
    const p = replacePair(wifi, wifiSlash, s, t);
    expect(p.out.every((x) => !x.visible)).toBe(true);
    expect(p.in[0]!.alpha).toBe(1);
    expect(p.in[0]!.transform).toEqual(IDENTITY);
    expect(p.in[1]!.strokeClip).toBe(true);
    expect(p.in[1]!.strokeEnd).toBeCloseTo(f(1.08) * curve(25)(0.5), 6);
    const peak = replacePair(wifi, wifiSlash, s, f(0.3333333432674408)).in[1]!;
    expect(peak.strokeEnd).toBeCloseTo(f(1.08), 6);
    expect(replaceDuration(wifi, wifiSlash, s)).toBeCloseTo(f(0.6666666865348816), 6);
  });

  it("slash remove: the source's slash retracts 1 → 0; everything scales 1 → 1.05 → 0.97 → 1; 0.7 s", () => {
    const s = magic();
    const p = replacePair(wifiSlash, wifi, s, 0.125);
    expect(p.out[0]!.visible).toBe(false); // non-slash source layer
    expect(p.out[1]!.strokeEnd).toBeCloseTo(1 - curve(30)(0.5), 6);
    const k = 1 + (f(1.05) - 1) * curve(27)(0.125 / f(0.2199999988079071));
    expect(scaleOf(p.out[1]!)).toBeCloseTo(k, 6);
    for (const x of p.in) expect(scaleOf(x)).toBeCloseTo(k, 6);
    expect(scaleOf(replacePair(wifiSlash, wifi, s, f(0.44)).in[0]!)).toBeCloseTo(f(0.97), 5);
    expect(replaceDuration(wifiSlash, wifi, s)).toBeCloseTo(f(0.699999988079071), 6);
  });

  it("a non-strokable slash layer: stroke-end multiplies its alpha, clamped to 1", () => {
    const flat = drawing([{ tags: ["wifi", "wifi.slash"] }, { tags: ["_slash", "wifi.slash"] }], "wifi.slash");
    const peak = replacePair(wifi, flat, magic(), f(0.3333333432674408)).in[1]!;
    expect(peak.strokeClip).toBe(false);
    expect(peak.alpha).toBe(1);
    expect(replacePair(wifi, flat, magic(), 0.1).in[1]!.alpha).toBeCloseTo(f(1.08) * curve(25)(0.1 / f(0.3333333432674408)), 6);
  });

  const bell = drawing([{ tags: ["bell"] }], "bell");
  const bellBadge = drawing([{ tags: ["bell"] }, { tags: ["_badge"] }], "bell.badge");
  const bellBadge2 = drawing([{ tags: ["bell"] }, { tags: ["_badge", "other"] }], "bell.badge2");

  it("badge add: all scale from 0.05; the destination badge grows 0.75 → 1 and fades in over 0.25; 1.0 s", () => {
    const s = magic();
    const p = replacePair(bell, bellBadge, s, 0.125);
    expect(p.out[0]!.visible).toBe(false);
    expect(p.in[1]!.alpha).toBeCloseTo(curve(32)(0.5), 6);
    // scale-badge about the badge centre combines with the all-layers scale about the metric centre
    const all = 1 + (f(1.05) - 1) * curve(37)(0.075 / f(0.21699999272823334));
    expect(scaleOf(p.in[0]!)).toBeCloseTo(all, 6);
    expect(scaleOf(p.in[1]!)).toBeCloseTo(all * (0.75 + 0.25 * curve(31)(0.5)), 6);
    expect(scaleOf(replacePair(bell, bellBadge, s, 0.05).in[0]!)).toBe(1);
    expect(replaceDuration(bell, bellBadge, s)).toBeCloseTo(1, 6);
  });

  it("badge remove: the source badge shrinks to 0.75 and fades out over 0.167", () => {
    const p = replacePair(bellBadge, bell, magic(), f(0.16699999570846558));
    expect(p.out[1]!.visible).toBe(false);
    expect(p.out[0]!.visible).toBe(false); // non-badge source layer
    const q = replacePair(bellBadge, bell, magic(), 0.1);
    expect(q.out[1]!.alpha).toBeCloseTo(1 - curve(34)(0.1 / f(0.16699999570846558)), 6);
    expect(scaleOf(q.in[0]!)).toBeCloseTo(1 + (f(0.95) - 1) * curve(37)(0.1 / f(0.21699999272823334)), 6);
  });

  it("badge move: source badge 1 → 0.5 then gone at 0.25; destination badge from 0.25, 0.5 → 1", () => {
    const s = magic();
    const early = replacePair(bellBadge, bellBadge2, s, 0.125);
    expect(early.out[1]!.visible).toBe(true);
    expect(early.in[1]!.visible).toBe(false);
    const late = replacePair(bellBadge, bellBadge2, s, 0.375);
    expect(late.out[1]!.visible).toBe(false);
    expect(late.in[1]!.visible).toBe(true);
    expect(late.in[0]!.visible).toBe(true);
    const all = (t: number) => {
      // badge remove's scale values, from 0.05
      const d = f(0.21699999272823334);
      const u = t - 0.05;
      return u < d ? 1 + (f(0.95) - 1) * curve(37)(u / d) : f(0.95) + (f(1.059) - f(0.95)) * curve(38)((u - d) / d);
    };
    expect(scaleOf(late.in[1]!)).toBeCloseTo(all(0.375) * (0.5 + 0.5 * curve(36)(0.5)), 6);
    expect(scaleOf(early.out[1]!)).toBeCloseTo(all(0.125) * (1 - 0.5 * curve(35)(0.5)), 6);
  });
});

// ---- Magic Replace: the draw subtypes (07 §7.10) -----------------------------------------------

describe("magic replace: draw subtypes 5–7", () => {
  it("5: the source draws off from 0 (stroke-start on curve 18, plateau, rider scale), the destination on from s8", () => {
    const plus = drawing([{ tags: ["plus"], stroke: 2 }, { tags: ["dot"] }], "plus");
    const minus = drawing([{ tags: ["minus"], stroke: 1 }], "minus");
    const s = magic();
    expect(replaceSubtype(plus, minus)).toBe(5);
    const off = drawDur(2);
    const on = drawDur(1);
    // the source's one group: max(off, the base 0.25 of its other layer), + 1/30 for its clipping layer
    const s8 = Math.max(off, 0.25) + THIRTIETH;
    const mid = replacePair(plus, minus, s, off / 2);
    expect(mid.out[0]!.strokeClip).toBe(true);
    expect(mid.out[0]!.strokeStart).toBeCloseTo(f(0.9999) * curve(18)(0.5), 6);
    // the non-strokable source layer plays the downUp out half
    expect(scaleOf(mid.out[1]!)).toBeCloseTo(1 - 0.5 * curve(19)(off / 2 / 0.25), 6);
    // the plateau, then the rider scale and the bit-29 clip-alpha
    const plateau = replacePair(plus, minus, s, off + THIRTIETH / 2).out[0]!;
    expect(plateau.strokeStart).toBeCloseTo(f(0.9999), 6);
    expect(plateau.attachmentScale).toBeCloseTo(1 - 0.5 * 0.5, 6);
    expect(plateau.visible).toBe(true);
    expect(replacePair(plus, minus, s, off + THIRTIETH).out[0]!.visible).toBe(false);
    // the destination: hidden until s8, then stroke-end 0 → 1 on curve 17
    expect(replacePair(plus, minus, s, s8 - 0.001).in[0]!.visible).toBe(false);
    const dest = replacePair(plus, minus, s, s8 + on / 2).in[0]!;
    expect(dest.visible).toBe(true);
    expect(dest.strokeEnd).toBeCloseTo(curve(17)(0.5), 6);
    expect(replaceDuration(plus, minus, s)).toBeCloseTo(s8 + on, 6);
  });

  it("5 with a source that cannot stroke: every source layer plays the out half; s8 is the base 0.25", () => {
    const flat = drawing([{ tags: ["plus"] }], "plus");
    const minus = drawing([{ tags: ["minus"], stroke: 1 }, { tags: ["bar"] }], "minus");
    const s = magic();
    expect(replaceSubtype(flat, minus)).toBe(5);
    expect(scaleOf(replacePair(flat, minus, s, 0.1).out[0]!)).toBeCloseTo(1 - 0.5 * curve(19)(0.1 / 0.25), 6);
    const p = replacePair(flat, minus, s, 0.3);
    expect(p.in[0]!.strokeEnd).toBeCloseTo(curve(17)(0.05 / drawDur(1)), 6);
    // the destination's non-strokable layer plays the downUp in half from s8 = 0.25
    expect(scaleOf(p.in[1]!)).toBeCloseTo(0.5 + 0.5 * curve(20)(0.05 / 0.25), 6);
  });

  it("6: the enclosures cross-fade over 0.083, the source's from max(s8, 0.083), the destination's from s8 − 0.083", () => {
    const check = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["checkmark"], stroke: 1 }], "checkmark.circle");
    const checkFill = drawing([{ tags: ["_enclosure.fill", "circle"] }, { tags: ["checkmark"], stroke: 1 }], "checkmark.circle.fill");
    const s = magic();
    expect(replaceSubtype(check, checkFill)).toBe(6);
    const s8 = drawDur(1) + THIRTIETH; // the enclosure takes no part
    // the source enclosure: whole until s8, then fading on curve 1
    expect(replacePair(check, checkFill, s, s8 - 0.001).out[0]!.alpha).toBe(1);
    expect(replacePair(check, checkFill, s, s8 + F083 / 2).out[0]!.alpha).toBeCloseTo(1 - curve(1)(0.5), 6);
    expect(replacePair(check, checkFill, s, s8 + F083).out[0]!.visible).toBe(false);
    // the destination enclosure: hidden until s8 − 0.083, then fading in
    expect(replacePair(check, checkFill, s, s8 - F083 - 0.001).in[0]!.visible).toBe(false);
    expect(replacePair(check, checkFill, s, s8 - F083 / 2).in[0]!.alpha).toBeCloseTo(curve(1)(0.5), 6);
    expect(replacePair(check, checkFill, s, s8).in[0]!.alpha).toBe(1);
    // the enclosure does not scale (no out/in half reaches it)
    expect(replacePair(check, checkFill, s, 0.1).out[0]!.transform).toEqual(IDENTITY);
    expect(replaceDuration(check, checkFill, s)).toBeCloseTo(Math.max(s8, F083) + Math.max(drawDur(1), F083), 6);
  });

  it("7: the source's enclosure is hidden and the destination's drawn once, untouched", () => {
    const up = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["arrow.up"], stroke: 2 }], "arrow.up.circle");
    const down = drawing([{ tags: ["_enclosure.stroke", "circle"] }, { tags: ["arrow.down"], stroke: 2 }], "arrow.down.circle");
    for (const t of [0, 0.2, 0.6]) {
      const p = replacePair(up, down, magic(), t);
      expect(p.out[0]!.visible).toBe(false);
      expect(p.in[0]!.visible).toBe(true);
      expect(p.in[0]!.alpha).toBe(1);
      expect(p.in[0]!.transform).toEqual(IDENTITY);
    }
  });

  it("style 3: the source only fades over 0.083 on curve 1; the destination draws on from 0", () => {
    const plus = drawing([{ tags: ["plus"], stroke: 2 }], "plus");
    const minus = drawing([{ tags: ["minus"], stroke: 1 }, { tags: ["bar"] }], "minus");
    const s = magic({ replaceStyle: "offUp" });
    const p = replacePair(plus, minus, s, F083 / 2);
    expect(p.out[0]!.alpha).toBeCloseTo(1 - curve(1)(0.5), 6);
    expect(p.out[0]!.strokeClip).toBe(false);
    expect(p.in[0]!.strokeEnd).toBeCloseTo(curve(17)(F083 / 2 / drawDur(1)), 6);
    expect(p.in[1]!.alpha).toBeCloseTo(curve(24)(F083 / 2 / 0.25), 6);
    expect(replacePair(plus, minus, s, F083).out[0]!.visible).toBe(false);
    // the off half counts 0, the floor 0.083: max(on, 0.083), on = max(drawDur(1), the base 0.25 of "bar")
    expect(replaceDuration(plus, minus, s)).toBeCloseTo(Math.max(drawDur(1), 0.25, F083), 6);
  });

  it("style 2: the destination's in half starts at s8 − 1/12", () => {
    const plus = drawing([{ tags: ["plus"], stroke: 2 }], "plus");
    const minus = drawing([{ tags: ["minus"], stroke: 1 }, { tags: ["bar"] }], "minus");
    const s = magic({ replaceStyle: "upUp" });
    const s8 = drawDur(2) + THIRTIETH;
    const s0 = s8 - f(1 / 12);
    expect(replacePair(plus, minus, s, s0 - 0.001).in[1]!.visible).toBe(false);
    const x = replacePair(plus, minus, s, s0 + 0.1).in[1]!;
    expect(x.alpha).toBeCloseTo(curve(22)(0.1 / D333), 5);
  });
});
