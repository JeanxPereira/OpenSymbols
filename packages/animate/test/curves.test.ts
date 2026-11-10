import { describe, expect, it } from "vitest";
import { CURVE_COUNT, CURVE_TABLE, curve } from "../src/curves.js";

/** The Bézier (0,0) (x1,y1) (x2,y2) (1,1) at parameter s, independently of the solver. */
function bezier(c: readonly [number, number, number, number], s: number): [number, number] {
  const [x1, y1, x2, y2] = c;
  const m = 1 - s;
  const x = 3 * m * m * s * x1 + 3 * m * s * s * x2 + s * s * s;
  const y = 3 * m * m * s * y1 + 3 * m * s * s * y2 + s * s * s;
  return [x, y];
}

describe("curve table (Docs/format/07 §3.2)", () => {
  it("has 42 entries stored as float32", () => {
    expect(CURVE_COUNT).toBe(42);
    expect(CURVE_TABLE).toHaveLength(42);
    // 07 §3.2: `0.33` is the float32 0.33000001311302185.
    expect(CURVE_TABLE[1]![0]).toBe(0.33000001311302185);
    expect(CURVE_TABLE[40]).toEqual([0.3499999940395355, 0, 0.25, 1]);
    for (const row of CURVE_TABLE) for (const v of row) expect(Math.fround(v)).toBe(v);
  });

  it("is 07 §3.2's table, row for row", () => {
    // A literal copy of Docs/format/07 §3.2 (id: x1 y1 x2 y2).
    const DOC = `
      0 0 1 1 | 0.33 0 0.67 1 | 0.4 0 0.6 1 | 0.55 0 0.67 1 | 0.45 0 0.67 1 | 0.25 0 0.55 1 |
      0.55 0 0.67 1 | 0.33 0 0.67 1 | 0.12 0.17 0.67 1 | 0.33 0 0.88 0.83 | 0.25 0.25 0.25 1 |
      0.33 0 0.88 0.83 | 0.17 0.17 0.83 0.83 | 0.4 0.5 0.8 1 | 0.33 0 0.67 1 | 0.33 0 0.2 1 |
      0.33 0 0.8 0.7 | 0.2 0 0.25 1 | 0.4 0 0.8 1 | 0.75 0 0.8 1 | 0.2 0 0.25 1 | 0.33 0 0.83 0.83 |
      0.17 0.17 0.67 1 | 0.2 0 0.25 1 | 0.33 0 0.67 1 | 0.33 0 0.67 1 | 0.33 0 0.67 1 | 0.55 0 0.67 1 |
      0.45 0 0.67 1 | 0.25 0 0.55 1 | 0.33 0 0.67 1 | 0.33 0 0.2 1 | 0.33 0 0.67 1 | 0.33 0 0.8 0.7 |
      0.33 0 0.67 1 | 0.75 0 0.8 1 | 0.2 0 0.25 1 | 0.55 0 0.67 1 | 0.45 0 0.67 1 | 0.25 0 0.55 1 |
      0.35 0 0.25 1 | 0.75 0 0.65 1`;
    const rows = DOC.split("|").map((r) => r.trim().split(/\s+/).map((v) => Math.fround(Number(v))));
    expect(rows).toHaveLength(42);
    expect(CURVE_TABLE.map((r) => [...r])).toEqual(rows);
  });

  it("rows from the doc", () => {
    expect(CURVE_TABLE[8]).toEqual([Math.fround(0.12), Math.fround(0.17), Math.fround(0.67), 1]);
    expect(CURVE_TABLE[12]).toEqual([Math.fround(0.17), Math.fround(0.17), Math.fround(0.83), Math.fround(0.83)]);
    expect(CURVE_TABLE[41]).toEqual([0.75, 0, Math.fround(0.65), 1]);
  });
});

describe("curve(id)", () => {
  it("every curve hits (0,0) and (1,1)", () => {
    for (let id = 0; id < CURVE_COUNT; id++) {
      const f = curve(id);
      expect(f(0), `curve ${id} at 0`).toBe(0);
      expect(f(1), `curve ${id} at 1`).toBe(1);
    }
  });

  it("every curve passes through its Bézier points", () => {
    for (let id = 0; id < CURVE_COUNT; id++) {
      const f = curve(id);
      for (let k = 1; k < 20; k++) {
        const [x, y] = bezier(CURVE_TABLE[id]!, k / 20);
        expect(Math.abs(f(x) - y), `curve ${id} at s=${k / 20}`).toBeLessThan(1e-9);
      }
    }
  });

  it("curves 0 and 12 are exactly linear (07 §3.3)", () => {
    for (const u of [0.1, 0.25, 0.5, 0.7311, 0.99]) {
      expect(curve(0)(u)).toBe(u);
      expect(curve(12)(u)).toBe(u);
    }
  });

  it("curve 1 is the (near-)symmetric ease-in-out", () => {
    // Not exact: the float32 controls 0.33 and 0.67 do not sum to 1 (07 §2.8, §3.2).
    expect(curve(1)(0.5)).toBeCloseTo(0.5, 7);
    expect(curve(1)(0.5)).not.toBe(0.5);
    expect(curve(1)(0.25)).toBeLessThan(0.25);
    expect(curve(1)(0.75)).toBeGreaterThan(0.75);
  });

  it("no curve overshoots [0, 1] (07 §3.3) and each is monotone", () => {
    for (let id = 0; id < CURVE_COUNT; id++) {
      const f = curve(id);
      let prev = 0;
      for (let k = 0; k <= 200; k++) {
        const y = f(k / 200);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = y;
      }
    }
  });

  it("clamps u, maps non-finite u to 0, treats an index past 41 as linear (07 §3.1)", () => {
    expect(curve(5)(-3)).toBe(0);
    expect(curve(5)(7)).toBe(1);
    expect(curve(5)(NaN)).toBe(0);
    expect(curve(5)(Infinity)).toBe(0);
    expect(curve(42)(0.3)).toBe(0.3);
    expect(curve(-1)(0.3)).toBe(0.3);
    expect(curve(2.5)(0.3)).toBe(0.3);
  });
});
