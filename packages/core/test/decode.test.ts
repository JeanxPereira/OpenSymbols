import { describe, expect, it } from "vitest";
import { argCountsOf, decodeSymbol, delta, undelta } from "../src/decode.js";
import type { SymbolData, SymbolWire } from "../src/format.js";

const style = { paint: { kind: "tint" as const } };
const wire = (): SymbolWire => ({
  v: 2,
  name: "x",
  palette: "apple",
  defaultVariant: "a0d0",
  modes: ["monochrome", "palette"],
  build: { validated: true },
  variants: {
    a0d0: {
      ops: "MLCZ",
      masters: {
        4: { args: delta([10, 20, 30, 20, 30, 40, 50, 60, 70, 80]), viewBox: [0, 0, 1, 1], transform: [1, 0, 0, 1, 0, 0] },
      },
      layers: [
        {
          cmd: [0, 4],
          role: "primary",
          modes: { monochrome: style, hierarchical: { ...style, opacity: 0.5 }, multicolor: { ...style, clearBehind: true }, palette: style },
          motionGroup: 0,
          anim: { tags: ["x"], familyLayer: 0 },
        },
      ],
      variableValueMode: "color",
      vcContinuous: false,
    },
  },
});

describe("format 2 (decodeSymbol)", () => {
  it("delta and undelta are inverses, pairing each value with the one two before", () => {
    const a = [3, 5, 4, 9, -2, 7, 0];
    expect(delta(a)).toEqual([3, 5, 1, 4, -6, -2, 2]);
    expect(undelta(delta(a))).toEqual(a);
    expect(undelta([])).toEqual([]);
  });

  it("undelta is exact for the encoder's 3-decimal args, not only for integers", () => {
    const a = [53.723, -12.5, 0.001, 7.333, 53.723, 100.999, -0.007, 3.141];
    expect(undelta(delta(a))).toEqual(a);
    let x = 0.1;
    const long = Array.from({ length: 400 }, () => (x = Math.round((x * 7.3 + 1.234) % 97 * 1000) / 1000));
    expect(undelta(delta(long))).toEqual(long);
  });

  it("argCounts come from the ops; an op outside M L Q C Z throws", () => {
    expect(argCountsOf("MLQCZ")).toEqual([2, 2, 4, 6, 0]);
    expect(() => argCountsOf("Mh")).toThrow(TypeError);
  });

  it("expands a format 2 symbol: args summed back, argCounts, defaults restored", () => {
    const d = decodeSymbol(wire());
    expect(d.v).toBe(1);
    const v = d.variants.a0d0!;
    expect(v.argCounts).toEqual([2, 2, 6, 0]);
    expect(v.masters[4]!.args).toEqual([10, 20, 30, 20, 30, 40, 50, 60, 70, 80]);
    const l = v.layers[0]!;
    expect(l.modes.monochrome).toEqual({ paint: { kind: "tint" }, opacity: 1, clearBehind: false });
    expect(l.modes.hierarchical.opacity).toBe(0.5);
    expect(l.modes.multicolor.clearBehind).toBe(true);
    expect(l.anim).toEqual({ tags: ["x"], familyLayer: 0, alwaysRotates: false, alwaysPulses: false, strokeKeyframes: [], attachments: [] });
  });

  it("expands localized variants the same way", () => {
    const w = wire();
    w.locales = { ar: { a0d0: w.variants.a0d0! } };
    expect(decodeSymbol(w).locales!.ar!.a0d0!.masters[4]!.args).toEqual([10, 20, 30, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("returns format 1 as is, caches format 2 per object, rejects other versions", () => {
    const w = wire();
    expect(decodeSymbol(w)).toBe(decodeSymbol(w));
    const one = decodeSymbol(w);
    expect(decodeSymbol(one as SymbolData)).toBe(one);
    expect(() => decodeSymbol({ ...w, v: 3 } as unknown as SymbolWire)).toThrow(TypeError);
  });

  it("a master whose args do not match its ops throws", () => {
    const w = wire();
    w.variants.a0d0!.masters[4]!.args.pop();
    expect(() => decodeSymbol(w)).toThrow(/args/);
  });
});
