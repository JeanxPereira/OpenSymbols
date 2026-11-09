import type { LayerData, LayerStyleData, RenderMode, SymbolData, VariantData } from "@opensymbols/core";
import { describe, expect, it } from "vitest";
import { symbolFacts } from "../../src/generate/assemble.js";

const style: LayerStyleData = { paint: { kind: "tint" }, opacity: 1, clearBehind: false };
const layer = (variableThreshold?: number): LayerData => ({
  cmd: [0, 1],
  role: "primary",
  modes: { monochrome: style, hierarchical: style, multicolor: style, palette: style },
  motionGroup: 0,
  ...(variableThreshold !== undefined ? { variableThreshold } : {}),
});
const variant = (layers: LayerData[]): VariantData => ({
  ops: "M",
  argCounts: [2],
  masters: {},
  layers,
  variableValueMode: "color",
  vcContinuous: false,
});
const symbol = (over: Partial<SymbolData>): SymbolData => ({
  v: 1,
  name: "x",
  palette: "apple",
  variants: { a0d0: variant([layer()]) },
  defaultVariant: "a0d0",
  modes: ["monochrome", "multicolor"] as RenderMode[],
  build: { validated: true },
  ...over,
});

describe("symbolFacts", () => {
  it("variableValue: a threshold on a layer of the default variant only", () => {
    expect(symbolFacts(symbol({})).variableValue).toBe(false);
    expect(symbolFacts(symbol({ variants: { a0d0: variant([layer(), layer(0.5)]) } })).variableValue).toBe(true);
    // A threshold in another variant does not count.
    const other = symbol({ variants: { a0d0: variant([layer()]), a1d0: variant([layer(0.5)]) } });
    expect(symbolFacts(other).variableValue).toBe(false);
  });
  it("approximate: palette for stand-in multicolor, build when unvalidated, in that order", () => {
    expect(symbolFacts(symbol({})).approximate).toEqual([]);
    expect(symbolFacts(symbol({ palette: "stand-in" })).approximate).toEqual(["palette"]);
    expect(symbolFacts(symbol({ palette: "stand-in", modes: ["monochrome"] })).approximate).toEqual([]);
    expect(symbolFacts(symbol({ build: { validated: false } })).approximate).toEqual(["build"]);
    expect(symbolFacts(symbol({ palette: "stand-in", build: { validated: false } })).approximate).toEqual([
      "palette",
      "build",
    ]);
  });
  it("carries the modes", () => {
    expect(symbolFacts(symbol({})).modes).toEqual(["monochrome", "multicolor"]);
  });
});
