import { describe, expect, it } from "vitest";
import { interpolate, weightValue, type VariantData, type Weight } from "../src/index.js";

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

describe("interpolate", () => {
  it("is exact at the masters and linear between", () => {
    expect(interpolate(full, 1).args).toEqual([0, 0]);
    expect(interpolate(full, 4).args).toEqual([10, 10]);
    expect(interpolate(full, 9).args).toEqual([40, 40]);
    expect(interpolate(full, 6.5).args).toEqual([25, 25]);
    expect(interpolate(full, 2.5).args).toEqual([5, 5]);
  });
  it("applies the same scalars to viewBox, transform and metrics", () => {
    const r = interpolate(full, 6.5);
    expect(r.viewBox).toEqual([0, 0, 25, 25]);
    expect(r.transform).toEqual([1, 0, 0, 1, 25, 25]);
    expect(r.metrics!.capHeight).toBe(25);
    expect(r.metrics!.leftInset).toBe(25);
  });
  it("flags approximate only away from 1, 4, 9", () => {
    for (const w of [1, 4, 9]) expect(interpolate(full, w).approximate).toBe(false);
    expect(interpolate(full, 6.5).approximate).toBe(true);
  });
  it("never yields NaN across a sweep", () => {
    for (let w = 1; w <= 9; w += 0.25) {
      const r = interpolate(full, w);
      const all = [...r.args, ...r.viewBox, ...r.transform, ...Object.values(r.metrics!)];
      expect(all.some(Number.isNaN)).toBe(false);
    }
  });
  it("regular-only variants return regular for every weight", () => {
    const only = variant({ 4: master(10) });
    expect(interpolate(only, 9).args).toEqual([10, 10]);
    expect(interpolate(only, 9).approximate).toBe(true);
    expect(interpolate(only, 4).approximate).toBe(false);
  });
  it("flags a weight whose master is not stored as masterMissing", () => {
    const only = variant({ 4: master(10) });
    expect(interpolate(only, 9).masterMissing).toBe(true);
    expect(interpolate(only, 2).masterMissing).toBe(true);
    expect(interpolate(only, 4).masterMissing).toBe(false);
    expect(interpolate(full, 6.5).masterMissing).toBe(false);
    expect(interpolate(variant({ 4: master(10), 9: master(40) }), 2).masterMissing).toBe(true);
  });
  it("has no metrics when a master it draws from has none", () => {
    const { metrics: _m, ...bare } = master(40);
    const noBlackMetrics = variant({ 1: master(0), 4: master(10), 9: bare });
    expect(interpolate(noBlackMetrics, 6).metrics).toBeUndefined();
    expect(interpolate(noBlackMetrics, 4).metrics?.capHeight).toBe(10);
    expect(interpolate(noBlackMetrics, 2.5).metrics?.capHeight).toBe(5);
    const { metrics: _r, ...bareRegular } = master(10);
    expect(interpolate(variant({ 4: bareRegular }), 4).metrics).toBeUndefined();
  });
  it("throws TypeError without master 4", () => {
    expect(() => interpolate(variant({ 1: master(0), 9: master(40) }), 4)).toThrow(TypeError);
  });
});
