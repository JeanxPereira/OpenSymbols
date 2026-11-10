import { describe, expect, it } from "vitest";
import { clockDelays, staggerOffsets, staggerStep } from "../src/groups.js";

const f = Math.fround;
const B = f(0.15000000596046448);
const C = f(0.05000000074505806);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("staggerStep (07 §4.2)", () => {
  it("is 0 under two groups", () => {
    expect(staggerStep(0, B, C)).toBe(0);
    expect(staggerStep(1, B, C)).toBe(0);
  });

  it("is the ceiling under B / C + 1 groups, then B / (n − 1)", () => {
    expect(staggerStep(2, B, C)).toBe(C);
    expect(staggerStep(3, B, C)).toBe(C);
    // n = 4: in float32 B / 3 = 0.0500000019 is just above C = 0.0500000007, so C still binds (07 §2.8).
    expect(staggerStep(4, B, C)).toBe(C);
    expect(staggerStep(5, B, C)).toBe(B / 4);
    expect(staggerStep(9, B, C)).toBe(B / 8);
  });

  it("a non-finite or negative budget or ceiling gives no stagger, never NaN", () => {
    expect(staggerStep(3, NaN, C)).toBe(0);
    expect(staggerStep(3, B, -1)).toBe(0);
    expect(staggerStep(3, Infinity, Infinity)).toBe(0);
  });
});

describe("staggerOffsets (07 §4.2, §4.4)", () => {
  it("one group starts at 0", () => {
    expect(staggerOffsets([0], B, C, "up")).toEqual([0]);
    expect(staggerOffsets([0], B, C, "down")).toEqual([0]);
    expect(staggerOffsets([], B, C, "up")).toEqual([]);
  });

  it("ascending: group i at i · step; descending: (n − 1 − i) · step, the last group leads", () => {
    expect(staggerOffsets([0, 1, 2], B, C, "up")).toEqual([0, C, 2 * C]);
    expect(staggerOffsets([0, 1, 2], B, C, "down")).toEqual([2 * C, C, 0]);
  });

  it("returns the offset of each listed group, in the order given", () => {
    expect(staggerOffsets([2, 0, 1], B, C, "up")).toEqual([2 * C, 0, C]);
  });

  it("9 and 40 groups stay inside the budget, the last at exactly n − 1 steps (Review Focus 1)", () => {
    for (const n of [9, 40]) {
      for (const order of ["up", "down"] as const) {
        const o = staggerOffsets(range(n), B, C, order);
        expect(o).toHaveLength(n);
        for (const v of o) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(B + 1e-12);
        }
        expect(Math.max(...o)).toBeCloseTo(B, 12);
      }
    }
  });
});

describe("clockDelays (07 §4.6)", () => {
  it("0.05 per group under 5 groups, else 0.15 / (n − 1)", () => {
    expect(clockDelays(1, "up")).toEqual([0]);
    expect(clockDelays(3, "up")).toEqual([0, C, 2 * C]);
    expect(clockDelays(4, "up")).toEqual([0, C, 2 * C, 3 * C]);
    const d5 = clockDelays(5, "up");
    expect(d5[1]).toBe(B / 4);
    expect(d5[4]).toBe(B);
  });

  it("down reverses: g' = n − 1 − g", () => {
    expect(clockDelays(3, "down")).toEqual([2 * C, C, 0]);
  });
});
