import { describe, expect, it } from "vitest";
import {
  BASELINE_K,
  interpolate,
  metricCenter,
  SCALE_SIZE,
  weightScalars,
  weightValue,
  type VariantData,
  type Weight,
} from "../src/index.js";

const master = (n: number) => ({
  args: [n, n],
  viewBox: [0, 0, n, n] as [number, number, number, number],
  transform: [1, 0, 0, 1, n, n] as [number, number, number, number, number, number],
  metrics: { referencePointSize: n, baselineOffset: n, capHeight: n, leftInset: n, rightInset: n },
});
const variant = (masters: VariantData["masters"]): VariantData => ({
  ops: "ML",
  argCounts: [1, 1],
  masters,
  layers: [],
  variableValueMode: "color",
  vcContinuous: false,
});
const full = variant({ 1: master(0), 4: master(10), 9: master(40) });

const bits = (x: number): string => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16).toUpperCase().padStart(16, "0");
};

/** The facts' table (CoreUI `_interpolationData`): float64 bits of (ul, black) per weight 1..9, per size. */
const TABLE_BITS: Record<number, [string, string][]> = {
  0.2: [["3F878D4FDF3B645A", "3F96A161E4F765FE"], ["0000000000000000", "3FB0EBEDFA43FE5D"], ["0000000000000000", "3FDBD70A3D70A3D7"], ["0000000000000000", "3FE628240B780347"], ["0000000000000000", "3FEA10624DD2F1AA"], ["0000000000000000", "3FECFB7E90FF9724"], ["BF789374BC6A7EFA", "3FEEBFB15B573EAB"], ["0000000000000000", "3FF1B295E9E1B08A"], ["BFC0F27BB2FEC56D", "3FF21CAC083126E9"]],
  0.5: [["3FE44816F0068DB9", "0000000000000000"], ["3FCDCC63F141205C", "0000000000000000"], ["BFAB089A02752546", "3FCD460AA64C2F83"], ["BFB24DD2F1A9FBE7", "3FDFCD35A858793E"], ["BFB24DD2F1A9FBE7", "3FE5F2E48E8A71DE"], ["BFB24DD2F1A9FBE7", "3FE94F0D844D013B"], ["BFB2EB1C432CA57A", "3FEC9930BE0DED29"], ["BFB374BC6A7EF9DB", "3FF147AE147AE148"], ["BFC0F5C28F5C28F6", "3FF2F487FCB923A3"]],
  1: [["3FF0000000000000", "0000000000000000"], ["3FE8C6318C6318C5", "0000000000000000"], ["3FD5555555555555", "0000000000000000"], ["0000000000000000", "0000000000000000"], ["0000000000000000", "3FC70A3D70A3D70A"], ["0000000000000000", "3FD45A1CAC083127"], ["0000000000000000", "3FE0000000000000"], ["0000000000000000", "3FE87283FA38F4BA"], ["0000000000000000", "3FF0000000000000"]],
  1.276: [["3FF116963D9051E1", "0000000000000000"], ["3FEBC66458828D43", "0000000000000000"], ["3FDE8DBB360985C0", "0000000000000000"], ["3FC74ED8ABDB49BD", "0000000000000000"], ["3FC30000125457BF", "3FC51D2DDF10A8F9"], ["3FBF64F84A513C71", "3FD2A6932FB51DCB"], ["3FB6AEC51F3AA86D", "3FDD53317CEC78E9"], ["3FA41782757FC52F", "3FE6677EE595F1E1"], ["BF74027194142A01", "3FED53317CEC78E9"]],
  1.647: [["3FF22A6131B49B45", "0000000000000000"], ["3FEECCA15557454B", "0000000000000000"], ["3FE3FFCE83037A78", "0000000000000000"], ["3FD7AAA925A138DD", "0000000000000000"], ["3FD338ED332F281C", "3FC0BBB6F687ED5A"], ["3FCFA153D07C3689", "3FCD8FE55E346796"], ["3FC6A4937A1E14A9", "3FD73D9A8F4B028B"], ["3FB33671EE6BC708", "3FE1C17F4CB5362A"], ["3F90615AB832434B", "3FE73D9A8F4B028B"]],
  // The XLarge row as read holds eight weights (no Black).
  2: [["3FF1DBF487FCB924", "BFA95810624DD2F2"], ["3FF0D6A161E4F766", "BF854C985F06F694"], ["3FE935A858793DD9", "0000000000000000"], ["3FE17C1BDA5119CE", "0000000000000000"], ["3FDDB3D07C84B5DD", "3FBB71758E219653"], ["3FD8CCCCCCCCCCCD", "3FCBD07C84B5DCC6"], ["3FD2B851EB851EB8", "3FD6872B020C49BA"], ["3FC7D566CF41F213", "3FE06DC5D6388659"]],
};

describe("weightValue", () => {
  it("maps names, clamps numbers, NaN is regular", () => {
    expect(weightValue("semibold")).toBe(6);
    expect(weightValue(12)).toBe(9);
    expect(weightValue(-3)).toBe(1);
    expect(weightValue(NaN)).toBe(4);
  });
  it("throws TypeError on an unknown name", () => {
    expect(() => weightValue("bogus" as Weight)).toThrow(TypeError);
    expect(() => weightValue("toString" as Weight)).toThrow(TypeError);
  });
});

describe("weightScalars (CoreUI's table)", () => {
  it("is exact, bit for bit, at Small for all nine weights", () => {
    TABLE_BITS[1]!.forEach(([ul, b], i) => {
      const s = weightScalars(i + 1, 1);
      expect([bits(s.ul), bits(s.b)]).toEqual([ul, b]);
    });
    expect(weightScalars(2, 1).ul).toBe(0.7741935483870966);
    expect(weightScalars(8, 1).b).toBe(0.7639789473684211);
  });
  it("is exact at every stored (weight, size), Medium and Large through SCALE_SIZE", () => {
    expect(SCALE_SIZE).toEqual({ small: 1, medium: 1.276, large: 1.647 });
    for (const [size, row] of Object.entries(TABLE_BITS)) {
      row.forEach(([ul, b], i) => {
        const s = weightScalars(i + 1, Number(size));
        expect([bits(s.ul), bits(s.b)], `w${i + 1} @ ${size}`).toEqual([ul, b]);
      });
    }
    // The facts' examples: Regular·Medium leans toward ultralight; Black·Medium is (−0.00489, 0.91641).
    expect(weightScalars(4, SCALE_SIZE.medium)).toEqual({ ul: 0.18209370032725572, b: 0 });
    expect(weightScalars(9, SCALE_SIZE.medium)).toEqual({ ul: -0.004885142961266188, b: 0.9164054336468129 });
    expect(weightScalars(4, SCALE_SIZE.large)).toEqual({ ul: 0.3697913043478261, b: 0 });
  });
  it("interpolates a fractional weight linearly between its keys (6.5: Semibold..Bold)", () => {
    const s = weightScalars(6.5, 1);
    expect(s.ul).toBe(0);
    expect(s.b).toBeCloseTo((0.318 + 0.5) / 2, 15);
    // The same as CoreUI's blend in its continuous keys (0.3, 0.4) at 0.35.
    expect(s.b).toBeCloseTo(0.318 + (0.5 - 0.318) * ((0.35 - 0.3) / (0.4 - 0.3)), 12);
    const m = weightScalars(6.5, SCALE_SIZE.medium);
    expect(m.ul).toBeCloseTo((0.12263442816150573 + 0.08860427868299477) / 2, 15);
    expect(m.b).toBeCloseTo((0.2914169278996865 + 0.45820271682340646) / 2, 15);
  });
  it("is bilinear for a size between rows", () => {
    const mid = (1 + 1.276) / 2;
    expect(weightScalars(4, mid).ul).toBeCloseTo(0.18209370032725572 / 2, 12);
    const s = weightScalars(6.5, mid);
    const corners = [weightScalars(6, 1), weightScalars(7, 1), weightScalars(6, 1.276), weightScalars(7, 1.276)];
    expect(s.ul).toBeCloseTo(corners.reduce((a, c) => a + c.ul, 0) / 4, 12);
    expect(s.b).toBeCloseTo(corners.reduce((a, c) => a + c.b, 0) / 4, 12);
  });
  it("does not clamp: beyond the table it extrapolates from the end segments", () => {
    expect(weightScalars(10, 1).b).toBeCloseTo(1 + (1 - 0.7639789473684211), 12);
    expect(weightScalars(0, 1).ul).toBeCloseTo(1 + (1 - 0.7741935483870966), 12);
    expect(weightScalars(4, 2.353).ul).toBeCloseTo(0.5464 + (0.5464 - 0.3697913043478261), 9);
    // XLarge has no Black entry: its row extends from Bold..Heavy ([INF]).
    expect(weightScalars(9, 2).ul).toBeCloseTo(0.1862 + (0.1862 - 0.2925), 12);
    expect(weightScalars(9, 2).b).toBeCloseTo(0.5134 + (0.5134 - 0.352), 12);
  });
});

describe("interpolate", () => {
  it("is exact at the masters at Small, with the table's scalars between", () => {
    expect(interpolate(full, 1, "small").args).toEqual([0, 0]);
    expect(interpolate(full, 4, "small").args).toEqual([10, 10]);
    expect(interpolate(full, 9, "small").args).toEqual([40, 40]);
    expect(interpolate(full, 7, "small").args).toEqual([25, 25]);
    expect(interpolate(full, 2, "small").args[0]).toBeCloseTo(10 - 0.7741935483870966 * 10, 12);
    expect(interpolate(full, 6.5, "small").args[0]).toBeCloseTo(10 + 0.409 * 30, 12);
  });
  it("defaults to Small; Regular at Small is the regular master unchanged", () => {
    const m = master(10);
    const r = interpolate(full, "regular");
    expect(r).toEqual(interpolate(full, 4, "small"));
    expect(r.args).toEqual(m.args);
    expect(r.viewBox).toEqual(m.viewBox);
    expect(r.transform).toEqual(m.transform);
    expect(r.metrics).toEqual(m.metrics);
    expect(r.approximate).toBe(false);
  });
  it("applies the same scalars to viewBox, transform and metrics", () => {
    const r = interpolate(full, 7, "small");
    expect(r.viewBox).toEqual([0, 0, 25, 25]);
    expect(r.transform).toEqual([1, 0, 0, 1, 25, 25]);
    expect(r.metrics!.capHeight).toBe(25);
    expect(r.metrics!.leftInset).toBe(25);
  });
  it("matches the facts' wifi worked example at weights 2, 6 and 8 (Small)", () => {
    const vb = (w: number, h: number) => ({ ...master(0), viewBox: [0, 0, w, h] as [number, number, number, number] });
    const wifi = variant({ 1: vb(10.968744, 7.959957), 4: vb(11.30517, 8.290035), 9: vb(12.136713, 9.020015) });
    const cases: [number, number, number][] = [
      [2, 11.044711, 8.034491],
      [3, 11.193028, 8.180009],
      [5, 11.454848, 8.421431],
      [6, 11.569601, 8.522169],
      [7, 11.720942, 8.655025],
      [8, 11.940451, 8.847724],
    ];
    for (const [w, width, height] of cases) {
      const r = interpolate(wifi, w, "small");
      expect(r.viewBox[2], `width w${w}`).toBeCloseTo(width, 5);
      expect(r.viewBox[3], `height w${w}`).toBeCloseTo(height, 5);
    }
  });
  it("is never approximate when every master is stored", () => {
    for (const scale of ["small", "medium", "large"] as const) {
      for (const w of [1, 2, 3, 4, 5, 6, 6.5, 7, 8, 9]) expect(interpolate(full, w, scale).approximate).toBe(false);
    }
  });
  it("never yields NaN across a sweep", () => {
    for (const scale of ["small", "medium", "large"] as const) {
      for (let w = 1; w <= 9; w += 0.25) {
        const r = interpolate(full, w, scale);
        const all = [...r.args, ...r.viewBox, ...r.transform, ...Object.values(r.metrics!)];
        expect(all.some(Number.isNaN)).toBe(false);
      }
    }
  });
  it("regular-only variants return regular for every weight, flagged away from regular", () => {
    const only = variant({ 4: master(10) });
    expect(interpolate(only, 9, "small").args).toEqual([10, 10]);
    expect(interpolate(only, 9, "small").approximate).toBe(true);
    expect(interpolate(only, 4, "small").approximate).toBe(false);
  });
  it("flags a weight whose master is not stored as masterMissing", () => {
    const only = variant({ 4: master(10) });
    expect(interpolate(only, 9).masterMissing).toBe(true);
    expect(interpolate(only, 2).masterMissing).toBe(true);
    expect(interpolate(only, 4).masterMissing).toBe(false);
    expect(interpolate(full, 6.5).masterMissing).toBe(false);
    expect(interpolate(variant({ 4: master(10), 9: master(40) }), 2).masterMissing).toBe(true);
    expect(interpolate(variant({ 4: master(10), 9: master(40) }), 6, "medium").masterMissing).toBe(false);
  });
  it("Regular at Medium: the table's ul scalar in a full package; regular-only is regular scaled, not flagged", () => {
    const S = SCALE_SIZE.medium;
    const x = 0.18209370032725572;
    const f = interpolate(full, 4, "medium");
    expect(f.args[0]).toBeCloseTo(10 + x * (0 - 10), 12);
    expect(f.viewBox[2]).toBeCloseTo(S * (10 - 10 * x), 12);
    expect(f.masterMissing).toBe(false);
    const only = interpolate(variant({ 4: master(10) }), 4, "medium");
    expect(only.args).toEqual([10, 10]);
    expect(only.viewBox).toEqual([0, 0, S * 10, S * 10]);
    expect(only.masterMissing).toBe(false);
    expect(only.approximate).toBe(false);
    // Black at Medium in a regular+black package: the missing ultralight's scalar counts as 0.
    const rb = interpolate(variant({ 4: master(10), 9: master(40) }), 9, "medium");
    expect(rb.args[0]).toBeCloseTo(10 + 0.9164054336468129 * 30, 12);
    expect(rb.masterMissing).toBe(false);
  });
  it("scales viewBox, transform and insets by S; baseline S·b + K·(S − 1)·X; cap height unscaled", () => {
    const only = variant({
      4: { ...master(10), metrics: { referencePointSize: 17, baselineOffset: 3, capHeight: 12, leftInset: 1, rightInset: 2 } },
    });
    for (const scale of ["small", "medium", "large"] as const) {
      const S = SCALE_SIZE[scale];
      const r = interpolate(only, 4, scale);
      expect(r.viewBox).toEqual([0, 0, S * 10, S * 10]);
      expect(r.transform).toEqual([S, 0, 0, S, S * 10, S * 10]);
      expect(r.args).toEqual([10, 10]);
      expect(r.metrics).toEqual({
        referencePointSize: 17,
        baselineOffset: S * 3 + BASELINE_K * (S - 1) * 17,
        capHeight: 12,
        leftInset: S * 1,
        rightInset: S * 2,
      });
    }
    expect(BASELINE_K).toBe(0.352294921875);
    expect(interpolate(only, 4, "small").metrics!.baselineOffset).toBe(3);
  });
  it("throws on an unknown scale", () => {
    expect(() => interpolate(full, 4, "huge" as "small")).toThrow(TypeError);
    expect(() => interpolate(full, 4, "toString" as "small")).toThrow(TypeError);
  });
  it("has no metrics when a master it draws from has none", () => {
    const { metrics: _m, ...bare } = master(40);
    const noBlackMetrics = variant({ 1: master(0), 4: master(10), 9: bare });
    expect(interpolate(noBlackMetrics, 6).metrics).toBeUndefined();
    expect(interpolate(noBlackMetrics, 4).metrics?.capHeight).toBe(10);
    expect(interpolate(noBlackMetrics, 3).metrics?.capHeight).toBeCloseTo(10 - 10 / 3, 12);
    // Medium's Regular draws on ultralight only: no black metrics needed.
    expect(interpolate(noBlackMetrics, 4, "medium").metrics).toBeDefined();
    const { metrics: _r, ...bareRegular } = master(10);
    expect(interpolate(variant({ 4: bareRegular }), 4).metrics).toBeUndefined();
  });
  it("throws TypeError without master 4", () => {
    expect(() => interpolate(variant({ 1: master(0), 9: master(40) }), 4)).toThrow(TypeError);
  });
});

describe("metricCenter (Docs/format/06 section 9.3)", () => {
  const m = { referencePointSize: 13, baselineOffset: 2, capHeight: 14, leftInset: 1, rightInset: 1 };
  it("is the worked example", () => {
    const c = metricCenter([0, 0, 20, 20], [0.01, 0, 0, 0.01, -1, 18], m)!;
    expect(c[0]).toBeCloseTo(1100, 6);
    expect(c[1]).toBeCloseTo(-700, 6);
  });
  it("is undefined for a singular transform", () => {
    expect(metricCenter([0, 0, 20, 20], [0, 0, 0, 0, 1, 1], m)).toBeUndefined();
  });
});

describe("interpolate rotation anchor and metric centre", () => {
  const withPoints = (n: number) => ({
    ...master(n),
    rotationAnchor: [n, 2 * n] as [number, number],
    metricCenter: [3 * n, 4 * n] as [number, number],
  });
  it("interpolates them like the viewBox", () => {
    const v = variant({ 1: withPoints(0), 4: withPoints(10), 9: withPoints(40) });
    const r = interpolate(v, 9);
    expect(r.rotationAnchor).toEqual([40, 80]);
    expect(r.metricCenter).toEqual([120, 160]);
    expect(interpolate(v, 7).rotationAnchor![0]).toBe(25);
    // Path space: the scale reaches them through the transform, not their coordinates.
    const med = interpolate(v, 9, "medium");
    expect(med.rotationAnchor![0]).toBeCloseTo(10 + -0.004885142961266188 * -10 + 0.9164054336468129 * 30, 12);
  });
  it("is undefined when a used master lacks them, and absent keys are not written", () => {
    const v = variant({ 1: master(0), 4: withPoints(10), 9: withPoints(40) });
    expect(interpolate(v, 1).rotationAnchor).toBeUndefined();
    expect(interpolate(v, 4).rotationAnchor).toEqual([10, 20]);
    expect("rotationAnchor" in interpolate(full, 4)).toBe(false);
  });
});
