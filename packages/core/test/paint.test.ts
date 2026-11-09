import { describe, expect, it } from "vitest";
import {
  resolveApproximations,
  resolveLayer,
  type LayerData,
  type LayerStyleData,
  type PaintData,
  type PaintOptions,
  type Role,
  type SymbolData,
  type VariantData,
} from "../src/index.js";

const style = (paint: PaintData, opacity = 1, clearBehind = false): LayerStyleData => ({ paint, opacity, clearBehind });
const layer = (role: Role, over: Partial<LayerData["modes"]> = {}, extra: Partial<LayerData> = {}): LayerData => ({
  cmd: [0, 1],
  role,
  modes: {
    monochrome: style({ kind: "tint" }),
    hierarchical: style({ kind: "role", role }),
    multicolor: style({ kind: "role", role }),
    palette: style({ kind: "role", role }),
    ...over,
  },
  motionGroup: 0,
  ...extra,
});
const opts = (o: Partial<PaintOptions> = {}): PaintOptions => ({
  mode: "monochrome",
  color: "#abcdef",
  appearance: "light",
  variableValueMode: "color",
  vcContinuous: false,
  ...o,
});
const variantOf = (s: SymbolData, key = "a0d0"): VariantData => s.variants[key]!;
const symbol = (over: { palette?: "apple" | "stand-in"; mode?: "color" | "draw"; threshold?: number } = {}): SymbolData => ({
  v: 1,
  name: "x",
  palette: over.palette ?? "apple",
  variants: {
    a0d0: {
      ops: "M",
      argCounts: [2],
      masters: {},
      layers: [layer("primary", {}, over.threshold === undefined ? {} : { variableThreshold: over.threshold })],
      variableValueMode: over.mode ?? "color",
      vcContinuous: false,
    },
  },
  defaultVariant: "a0d0",
  modes: ["monochrome", "hierarchical", "multicolor", "palette"],
  build: { validated: true },
});

describe("resolveLayer", () => {
  it("monochrome uses the tint", () => {
    expect(resolveLayer(layer("secondary"), opts())).toEqual({ fill: "#abcdef", opacity: 1, knockout: false, visible: true });
  });
  it("hierarchical applies the role level", () => {
    const h = (role: Role, appearance: "light" | "dark") => resolveLayer(layer(role), opts({ mode: "hierarchical", appearance })).opacity;
    expect(h("primary", "light")).toBe(1);
    expect(h("secondary", "dark")).toBe(0.5);
    expect(h("tertiary", "light")).toBe(0.18);
    expect(h("tertiary", "dark")).toBe(0.25);
  });
  it("hierarchical takes the level from the style's role paint over layer.role", () => {
    const l = layer("primary", { hierarchical: style({ kind: "role", role: "secondary" }) });
    expect(resolveLayer(l, opts({ mode: "hierarchical" })).opacity).toBe(0.5);
    const t = layer("tertiary", { hierarchical: style({ kind: "tint" }) });
    expect(resolveLayer(t, opts({ mode: "hierarchical" })).opacity).toBe(0.18);
  });
  it("hierarchical multiplies style opacity", () => {
    const l = layer("secondary", { hierarchical: style({ kind: "role", role: "secondary" }, 0.5) });
    expect(resolveLayer(l, opts({ mode: "hierarchical" })).opacity).toBe(0.25);
  });
  it("palette picks by role index, last repeats, full opacity", () => {
    const r = resolveLayer(layer("tertiary"), opts({ mode: "palette", palette: ["#111"] }));
    expect(r.fill).toBe("#111");
    expect(r.opacity).toBe(1);
    expect(resolveLayer(layer("secondary"), opts({ mode: "palette", palette: ["#111", "#222", "#333"] })).fill).toBe("#222");
  });
  it("palette takes the role from the style's role paint over layer.role", () => {
    const l = layer("primary", { palette: style({ kind: "role", role: "tertiary" }) });
    expect(resolveLayer(l, opts({ mode: "palette", palette: ["#111", "#222", "#333"] })).fill).toBe("#333");
    const tint = layer("secondary", { palette: style({ kind: "tint" }) });
    expect(resolveLayer(tint, opts({ mode: "palette", palette: ["#111", "#222", "#333"] })).fill).toBe("#222");
  });
  it("empty palette falls back to the tint", () => {
    expect(resolveLayer(layer("primary"), opts({ mode: "palette", palette: [] })).fill).toBe("#abcdef");
    expect(resolveLayer(layer("primary"), opts({ mode: "palette" })).fill).toBe("#abcdef");
  });
  it("multicolor paints", () => {
    const named = layer("primary", { multicolor: style({ kind: "named", name: "red", light: "#f00", dark: "#a00" }) });
    expect(resolveLayer(named, opts({ mode: "multicolor", appearance: "dark" })).fill).toBe("#a00");
    expect(resolveLayer(named, opts({ mode: "multicolor", appearance: "light" })).fill).toBe("#f00");
    const fixed = layer("primary", { multicolor: style({ kind: "fixed", hex: "#123456" }) });
    expect(resolveLayer(fixed, opts({ mode: "multicolor" })).fill).toBe("#123456");
    const tint = layer("primary", { multicolor: style({ kind: "tint" }) });
    expect(resolveLayer(tint, opts({ mode: "multicolor" })).fill).toBe("#abcdef");
    const role = layer("primary", { multicolor: style({ kind: "role", role: "secondary" }) });
    expect(resolveLayer(role, opts({ mode: "multicolor" })).opacity).toBe(0.5);
  });
  it("knockout follows clearBehind, still computes fill", () => {
    const l = layer("primary", { monochrome: style({ kind: "tint" }, 1, true) });
    expect(resolveLayer(l, opts())).toEqual({ fill: "#abcdef", opacity: 1, knockout: true, visible: true });
  });
  it("visible is false only at zero opacity and not knockout", () => {
    const z = layer("primary", { monochrome: style({ kind: "tint" }, 0) });
    expect(resolveLayer(z, opts()).visible).toBe(false);
    const zk = layer("primary", { monochrome: style({ kind: "tint" }, 0, true) });
    expect(resolveLayer(zk, opts()).visible).toBe(true);
  });
  describe("variable value (color mode)", () => {
    const l = layer("primary", {}, { variableThreshold: 0.5 });
    it("hard cut", () => {
      expect(resolveLayer(l, opts({ variableValue: 0.49 })).opacity).toBe(0.25);
      expect(resolveLayer(l, opts({ variableValue: 0.5 })).opacity).toBe(1);
    });
    it("continuous ramps over threshold +- 0.06", () => {
      const c = (v: number) => resolveLayer(l, opts({ variableValue: v, vcContinuous: true })).opacity;
      expect(c(0.5)).toBeCloseTo(0.625, 10);
      expect(c(0.44)).toBeCloseTo(0.25, 10);
      expect(c(0.3)).toBeCloseTo(0.25, 10);
      expect(c(0.56)).toBeCloseTo(1, 10);
      expect(c(0.9)).toBeCloseTo(1, 10);
    });
    it("scales the layer's own opacity", () => {
      const h = layer("secondary", {}, { variableThreshold: 0.5 });
      expect(resolveLayer(h, opts({ mode: "hierarchical", variableValue: 0 })).opacity).toBeCloseTo(0.125, 10);
    });
    it("no threshold or no value leaves opacity alone", () => {
      expect(resolveLayer(layer("primary"), opts({ variableValue: 0 })).opacity).toBe(1);
      expect(resolveLayer(l, opts()).opacity).toBe(1);
    });
    it("non-finite value means none applied; others are clamped to [0, 1]", () => {
      const o = (v: number, vcContinuous: boolean) => resolveLayer(l, opts({ variableValue: v, vcContinuous })).opacity;
      expect(o(NaN, false)).toBe(1);
      expect(o(NaN, true)).toBe(1);
      expect(o(-1, false)).toBe(o(0, false));
      expect(o(-1, true)).toBe(o(0, true));
      expect(o(2, false)).toBe(o(1, false));
      expect(o(2, true)).toBe(o(1, true));
      expect(resolveLayer(l, opts({ variableValue: NaN, vcContinuous: true })).visible).toBe(true);
    });
    it("draw mode ignores the value", () => {
      expect(resolveLayer(l, opts({ variableValue: 0, variableValueMode: "draw" })).opacity).toBe(1);
    });
  });
});

describe("resolveApproximations", () => {
  it("palette stand-in in multicolor", () => {
    expect(resolveApproximations(symbol({ palette: "stand-in" }), variantOf(symbol({ palette: "stand-in" })), opts({ mode: "multicolor" }))).toEqual(["palette"]);
    expect(resolveApproximations(symbol({ palette: "stand-in" }), variantOf(symbol({ palette: "stand-in" })), opts({ mode: "monochrome" }))).toEqual([]);
    expect(resolveApproximations(symbol(), variantOf(symbol()), opts({ mode: "multicolor" }))).toEqual([]);
  });
  it("variable-value when applied in color mode", () => {
    expect(resolveApproximations(symbol({ threshold: 0.5 }), variantOf(symbol({ threshold: 0.5 })), opts({ variableValue: 0.2 }))).toEqual(["variable-value"]);
    expect(resolveApproximations(symbol({ threshold: 0.5 }), variantOf(symbol({ threshold: 0.5 })), opts())).toEqual([]);
    expect(resolveApproximations(symbol(), variantOf(symbol()), opts({ variableValue: 0.2 }))).toEqual([]);
  });
  it("NaN value is not applied", () => {
    const sym = symbol({ threshold: 0.5 });
    expect(resolveApproximations(sym, variantOf(sym), opts({ variableValue: NaN }))).toEqual([]);
  });
  it("reads the chosen variant, not the default", () => {
    const sym = symbol({ threshold: 0.5 });
    const plain = symbol();
    sym.variants.other = variantOf(plain);
    sym.defaultVariant = "other";
    const o = opts({ variableValue: 0.2 });
    expect(resolveApproximations(sym, sym.variants.other, o)).toEqual([]);
    expect(resolveApproximations(sym, sym.variants.a0d0!, o)).toEqual(["variable-value"]);
    const draw = { ...variantOf(sym), variableValueMode: "draw" as const };
    expect(resolveApproximations(sym, draw, o)).toEqual(["variable-draw"]);
  });
  it("variable-draw in draw mode", () => {
    const o = opts({ variableValue: 0.3, variableValueMode: "draw" });
    expect(resolveApproximations(symbol({ mode: "draw" }), variantOf(symbol({ mode: "draw" })), o)).toEqual(["variable-draw"]);
  });
  it("stable order", () => {
    const o = opts({ mode: "multicolor", variableValue: 0.3, variableValueMode: "draw" });
    expect(resolveApproximations(symbol({ palette: "stand-in", mode: "draw" }), variantOf(symbol({ palette: "stand-in", mode: "draw" })), o)).toEqual(["palette", "variable-draw"]);
    const o2 = opts({ mode: "multicolor", variableValue: 0.3 });
    expect(resolveApproximations(symbol({ palette: "stand-in", threshold: 0.5 }), variantOf(symbol({ palette: "stand-in", threshold: 0.5 })), o2)).toEqual(["palette", "variable-value"]);
  });
});
