import { describe, expect, it } from "vitest";
import {
  buildSvg,
  formatSignificant,
  pickVariant,
  resolveLocale,
  SCALE_SIZE,
  BASELINE_K,
  serializePath,
  type LayerData,
  type RenderOptions,
  type SvgNode,
  type SymbolData,
  type VariantData,
} from "../src/index.js";

const find = (n: SvgNode, tag: SvgNode["tag"]): SvgNode[] => [
  ...(n.tag === tag ? [n] : []),
  ...n.children.flatMap((c) => find(c, tag)),
];

const layer = (cmd: [number, number], clearBehind = false): LayerData => {
  const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind };
  return { cmd, role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 };
};

const master = (vb: [number, number, number, number], ref = 17, transform: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]) => ({
  args: [0, 0, 1, 1, 0, 0, 2, 2],
  viewBox: vb,
  transform,
  metrics: { referencePointSize: ref, baselineOffset: 3, capHeight: 10, leftInset: 0, rightInset: 0 },
});

const variant = (over: Partial<VariantData> = {}, vb: [number, number, number, number] = [0, 0, 10, 5]): VariantData => ({
  ops: "MLMLZ",
  argCounts: [2, 2, 2, 2, 0],
  masters: { 4: master(vb) },
  layers: [layer([0, 2]), layer([2, 5], true)],
  variableValueMode: "color",
  vcContinuous: false,
  ...over,
});

const symbol = (variants: Record<string, VariantData>, def = "a0d0"): SymbolData => ({
  v: 1,
  name: "x",
  palette: "apple",
  variants,
  defaultVariant: def,
  modes: ["monochrome", "hierarchical", "multicolor", "palette"],
  build: { validated: true },
});

const ro = (o: Partial<RenderOptions> = {}): RenderOptions => ({
  mode: "monochrome",
  color: "#123456",
  appearance: "light",
  size: 24,
  weight: "regular",
  layout: "box",
  direction: "ltr",
  idPrefix: "p",
  // Small: the masters' own size, so the geometry below is the stored one.
  scale: "small",
  ...o,
});

describe("serializePath", () => {
  it("rounds to 3 decimals, drops -0, single spaces", () => {
    expect(serializePath("MLZ", [2, 2, 0], [1, -0, 2.00049, 3], [0, 3])).toBe("M1 0L2 3Z");
  });
  it("never uses exponent notation and keeps negatives spaced", () => {
    expect(serializePath("ml", [2, 2], [1e-7, -0.0001, 1.5, -2.25], [0, 2])).toBe("m0 0l1.5 -2.25");
  });
  it("throws instead of emitting exponent notation", () => {
    expect(() => serializePath("L", [2], [1e21, 0], [0, 1])).toThrow(TypeError);
  });
  it("serializes a sub-range using the right args offset", () => {
    expect(serializePath("MLMLZ", [2, 2, 2, 2, 0], [0, 0, 1, 1, 5, 6, 7, 8], [2, 5])).toBe("M5 6L7 8Z");
  });
});

describe("layouts", () => {
  it("box: square of the regular master's viewBox, centred", () => {
    const { root } = buildSvg(symbol({ a0d0: variant() }), ro());
    expect(root.attrs.viewBox).toBe("0 -2.5 10 10");
    expect(root.attrs.width).toBe(24);
    expect(root.attrs.height).toBe(24);
  });
  it("box: side from the largest master, centred on the interpolated viewBox; size never changes", () => {
    const v = variant({ masters: { 4: master([0, 0, 10, 5]), 9: master([0, 0, 14, 5]) } });
    const black = buildSvg(symbol({ a0d0: v }), ro({ weight: "black" })).root;
    expect(black.attrs.viewBox).toBe("0 -4.5 14 14");
    // Nothing of the black master's viewBox [0, 0, 14, 5] lies outside the box.
    const [x, y, w, h] = String(black.attrs.viewBox).split(" ").map(Number) as [number, number, number, number];
    expect(x).toBeLessThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(0);
    expect(x + w).toBeGreaterThanOrEqual(14);
    expect(y + h).toBeGreaterThanOrEqual(5);
    // Centred: equal margins on both sides.
    expect(0 - x).toBeCloseTo(x + w - 14);
    expect(0 - y).toBeCloseTo(y + h - 5);
    const regular = buildSvg(symbol({ a0d0: v }), ro()).root;
    expect(regular.attrs.viewBox).toBe("-2 -4.5 14 14");
    for (const r of [black, regular]) {
      expect(r.attrs.width).toBe(24);
      expect(r.attrs.height).toBe(24);
    }
  });
  it("text: scales by size / referencePointSize; the bottom edge sits baselineOffset below the baseline", () => {
    const { root, approximations } = buildSvg(symbol({ a0d0: variant() }), ro({ layout: "text", size: 34 }));
    expect(root.attrs.width).toBe(20);
    expect(root.attrs.height).toBe(10);
    // Docs/format/06 section 9.1: transform.f = viewBox height - baselineOffset.
    expect(root.attrs.style).toBe("vertical-align: -6px");
    expect(approximations).toEqual(["text-layout"]);
  });
  it("text without metrics: the box scale, flagged", () => {
    const { metrics: _m, ...bare } = master([0, 0, 10, 5]);
    const v = variant({ masters: { 4: bare } });
    const { root, approximations } = buildSvg(symbol({ a0d0: v }), ro({ layout: "text", size: 20 }));
    expect(root.attrs.width).toBe(20);
    expect(root.attrs.height).toBe(10);
    expect(root.attrs.style).toBeUndefined();
    expect(approximations).toEqual(["text-layout", "metrics"]);
    // Box layout does not need metrics.
    expect(buildSvg(symbol({ a0d0: v }), ro()).approximations).toEqual([]);
  });
  it("accessibility attributes", () => {
    const s = symbol({ a0d0: variant() });
    const a = buildSvg(s, ro()).root;
    expect(a.attrs["aria-hidden"]).toBe("true");
    expect(a.attrs.role).toBeUndefined();
    const b = buildSvg(s, ro({ title: "Star" })).root;
    expect(b.attrs.role).toBe("img");
    expect(b.attrs["aria-hidden"]).toBeUndefined();
    expect(find(b, "title")[0]!.text).toBe("Star");
    expect(b.attrs.xmlns).toBe("http://www.w3.org/2000/svg");
  });
});

describe("per-layer structure", () => {
  it("wraps each painted layer's path in its own <g data-layer=i> inside the transformed group", () => {
    const v = variant({ layers: [layer([0, 2]), layer([2, 5])] });
    const { root } = buildSvg(symbol({ a0d0: v }), ro());
    const group = root.children.find((c) => c.tag === "g")!;
    expect(group.attrs.transform).toBeDefined();
    expect(group.children.map((c) => [c.tag, c.attrs["data-layer"], c.children.length])).toEqual([
      ["g", 0, 1],
      ["g", 1, 1],
    ]);
    // The wrapper carries nothing but the index: paint and opacity stay on the path.
    for (const g of group.children) {
      expect(Object.keys(g.attrs)).toEqual(["data-layer"]);
      expect(g.children[0]!.tag).toBe("path");
      expect(g.children[0]!.attrs.fill).toBe("#123456");
    }
  });
  it("keeps the source layer index when a layer before it is not drawn", () => {
    const st = (o: number) => ({ paint: { kind: "tint" as const }, opacity: o, clearBehind: false });
    const hidden: LayerData = { ...layer([0, 2]), modes: { monochrome: st(0), hierarchical: st(0), multicolor: st(0), palette: st(0) } };
    const { root } = buildSvg(symbol({ a0d0: variant({ layers: [hidden, layer([2, 5])] }) }), ro());
    expect(find(root, "g").filter((g) => g.attrs["data-layer"] !== undefined).map((g) => g.attrs["data-layer"])).toEqual([1]);
  });
});

describe("number formatting", () => {
  it("keeps the wifi transform's scale to 6 significant digits (Docs/format/02 section 5.3)", () => {
    const wifi: [number, number, number, number, number, number] = [0.00634765, 0, 0, 0.00634765, -0.901367, 8.58203];
    const v = variant({ masters: { 4: master([0, 0, 10.968744, 7.959957], 13, wifi) } });
    const { root } = buildSvg(symbol({ a0d0: v }), ro());
    const g = root.children.find((c) => c.tag === "g")!;
    expect(g.attrs.transform).toBe("matrix(0.00634765 0 0 0.00634765 -0.901367 8.58203)");
    const scale = /^matrix\(([^ ]+)/.exec(String(g.attrs.transform))![1]!;
    expect(scale.replace(/^0\.0*/, "").length).toBeGreaterThanOrEqual(5);
  });
  it("never writes exponent notation, even for tiny values", () => {
    expect(formatSignificant(0.00000123456789)).toBe("0.00000123457");
    expect(formatSignificant(-0.00634765)).toBe("-0.00634765");
    expect(formatSignificant(1234567.89)).toBe("1234570");
    expect(formatSignificant(-0)).toBe("0");
    expect(formatSignificant(1e-30)).toBe("0");
    expect(formatSignificant(10.968744)).toBe("10.9687");
  });
  it("keeps small viewBox values", () => {
    const v = variant({ masters: { 4: master([0.00125, 0, 10, 10]) } });
    expect(buildSvg(symbol({ a0d0: v }), ro()).root.attrs.viewBox).toBe("0.00125 0 10 10");
  });
});

describe("knockout", () => {
  it("masks everything before the knockout and does not paint it", () => {
    const { root } = buildSvg(symbol({ a0d0: variant() }), ro());
    const masks = find(root, "mask");
    expect(masks).toHaveLength(1);
    expect(masks[0]!.attrs.id).toBe("p-k1");
    const g = find(root, "g").find((n) => n.attrs.mask === "url(#p-k1)")!;
    expect(g.children).toHaveLength(1);
    // Each painted layer sits in its own `<g data-layer>` (the effects driver's handle).
    expect(g.children[0]!.tag).toBe("g");
    expect(g.children[0]!.attrs["data-layer"]).toBe(0);
    expect(g.children[0]!.children[0]!.attrs.d).toBe("M0 0L1 1");
    expect(g.children[0]!.children[0]!.attrs.fill).toBe("#123456");
    // the knockout path is in the mask, same d as the layer, and nowhere else
    const kp = find(masks[0]!, "path")[0]!;
    expect(kp.attrs.d).toBe("M0 0L2 2Z");
    expect(find(root, "path").filter((p) => p.attrs.d === "M0 0L2 2Z")).toHaveLength(1);
    expect(find(masks[0]!, "rect")).toHaveLength(1);
  });
  it("nests so each knockout erases only what precedes it", () => {
    const v = variant({
      ops: "MLMLML",
      argCounts: [2, 2, 2, 2, 2, 2],
      masters: { 4: { ...master([0, 0, 10, 5]), args: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] } },
      layers: [layer([0, 2]), layer([2, 4], true), layer([4, 6]), layer([2, 4], true)],
    });
    // layers: 0 paint, 1 ko, 2 paint, 3 ko
    const { root } = buildSvg(symbol({ a0d0: v }), ro());
    expect(find(root, "mask").map((m) => m.attrs.id)).toEqual(["p-k1", "p-k3"]);
    const outer = root.children.find((c) => c.tag === "g")!.children[0]!;
    expect(outer.attrs.mask).toBe("url(#p-k3)");
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0]!.attrs.mask).toBe("url(#p-k1)");
    expect(outer.children[1]!.tag).toBe("g");
    expect(outer.children[1]!.attrs["data-layer"]).toBe(2);
    expect(outer.children[1]!.children.map((c) => c.tag)).toEqual(["path"]);
    // Each mask's knockout path names its layer, so an animated layer's mask copy can follow it.
    const masks = find(root, "mask");
    expect(masks.map((m) => find(m, "path")[0]!.attrs["data-layer"])).toEqual([1, 3]);
  });
  it("mask lives in path space: inverse of the transform applied to the viewBox", () => {
    const v = variant({ masters: { 4: master([0, 0, 10, 5], 17, [2, 0, 0, 2, 10, 10]) } });
    const { root } = buildSvg(symbol({ a0d0: v }), ro());
    const rect = find(root, "rect")[0]!;
    const x = Number(rect.attrs.x);
    const w = Number(rect.attrs.width);
    // viewBox x range [0,10] maps to path-space [-5, 0]; the mask must cover it
    expect(x).toBeLessThanOrEqual(-5);
    expect(x + w).toBeGreaterThanOrEqual(0);
    expect(find(root, "mask")[0]!.attrs.maskUnits).toBe("userSpaceOnUse");
  });
  it("every mask id carries the idPrefix", () => {
    const { root } = buildSvg(symbol({ a0d0: variant() }), ro({ idPrefix: "zz9" }));
    for (const m of find(root, "mask")) expect(String(m.attrs.id).startsWith("zz9-")).toBe(true);
    expect(find(root, "g").some((g) => g.attrs.mask === "url(#zz9-k1)")).toBe(true);
  });
  it("omits invisible layers and writes fill-opacity only below 1", () => {
    const st = (o: number) => ({ paint: { kind: "tint" as const }, opacity: o, clearBehind: false });
    const mk = (o: number): LayerData => ({ ...layer([0, 2]), modes: { monochrome: st(o), hierarchical: st(o), multicolor: st(o), palette: st(o) } });
    const v = variant({ layers: [mk(0), mk(0.5), mk(1)] });
    const paths = find(buildSvg(symbol({ a0d0: v }), ro()).root, "path");
    expect(paths).toHaveLength(2);
    expect(paths[0]!.attrs["fill-opacity"]).toBe(0.5);
    expect(paths[1]!.attrs["fill-opacity"]).toBeUndefined();
  });
});

describe("approximations", () => {
  it("lists weight-unavailable first, then paint reasons, from the chosen variant", () => {
    const v = variant({ variableValueMode: "draw", masters: { 4: master([0, 0, 10, 5]), 9: master([0, 0, 10, 5]) } });
    const r = buildSvg(symbol({ a0d0: v }), ro({ weight: "light", variableValue: 0.5 }));
    expect(r.approximations).toEqual(["weight-unavailable", "variable-draw"]);
    expect(r.approximate).toBe(true);
  });
  it("a weight with no stored master is weight-unavailable; an in-between weight is exact (the table)", () => {
    const only = symbol({ a0d0: variant() });
    expect(buildSvg(only, ro({ weight: "black" })).approximations).toEqual(["weight-unavailable"]);
    expect(buildSvg(only, ro({ weight: 6 })).approximations).toEqual(["weight-unavailable"]);
    const both = symbol({ a0d0: variant({ masters: { 4: master([0, 0, 10, 5]), 9: master([0, 0, 10, 5]) } }) });
    expect(buildSvg(both, ro({ weight: 6 })).approximations).toEqual([]);
    expect(buildSvg(both, ro({ weight: 6.5, scale: "large" })).approximations).toEqual([]);
    expect(buildSvg(both, ro({ weight: "black" })).approximations).toEqual([]);
  });
  it("regular in a regular-only package is not flagged at any scale, including the default", () => {
    const only = symbol({ a0d0: variant() });
    const { scale: _s, ...noScale } = ro();
    expect(buildSvg(only, noScale).approximations).toEqual([]);
    for (const scale of ["small", "medium", "large"] as const) expect(buildSvg(only, ro({ scale })).approximations).toEqual([]);
  });
  it("a mode the symbol does not have renders monochrome, flagged", () => {
    const fixed = { paint: { kind: "fixed" as const, hex: "#ff0000" }, opacity: 1, clearBehind: false };
    const l: LayerData = { ...layer([0, 2]), modes: { ...layer([0, 2]).modes, multicolor: fixed } };
    const s: SymbolData = { ...symbol({ a0d0: variant({ layers: [l] }) }), modes: ["monochrome", "palette"] };
    const r = buildSvg(s, ro({ mode: "multicolor" }));
    expect(r.approximations).toEqual(["mode"]);
    expect(find(r.root, "path")[0]!.attrs.fill).toBe("#123456");
    expect(buildSvg({ ...s, modes: ["multicolor"] }, ro({ mode: "multicolor" })).approximations).toEqual([]);
  });
  it("an unvalidated build is flagged", () => {
    const s: SymbolData = { ...symbol({ a0d0: variant() }), build: { validated: false } };
    expect(buildSvg(s, ro()).approximations).toEqual(["build"]);
  });
  it("is exact at regular with no variable value", () => {
    const r = buildSvg(symbol({ a0d0: variant() }), ro());
    expect(r.approximations).toEqual([]);
    expect(r.approximate).toBe(false);
  });
});

describe("pickVariant", () => {
  const a = variant({ ops: "Z" }), b = variant({ ops: "ZZ" }), c = variant({ ops: "ZZZ" }), d = variant({ ops: "ZZZZ" });
  it("dark picks a1d0 when present, else the default", () => {
    expect(pickVariant(symbol({ a0d0: a, a1d0: b }), "dark", "ltr")).toBe(b);
    expect(pickVariant(symbol({ a0d0: a }), "dark", "ltr")).toBe(a);
    expect(pickVariant(symbol({ a0d0: a, a1d0: b }), "light", "ltr")).toBe(a);
  });
  it("rtl picks direction 5 whenever it is stored, else the default", () => {
    expect(pickVariant(symbol({ a0d4: a, a0d5: b }, "a0d4"), "light", "rtl")).toBe(b);
    // A base drawn the same both ways plus its .rtl facet (Docs/format/05 §4.3): ltr d0, rtl d5.
    expect(pickVariant(symbol({ a0d0: a, a0d5: b }), "light", "rtl")).toBe(b);
    expect(pickVariant(symbol({ a0d0: a, a0d5: b }), "light", "ltr")).toBe(a);
    expect(pickVariant(symbol({ a0d0: a, a0d4: b }), "light", "rtl")).toBe(a);
  });
  it("ltr picks direction 4 when 4 and 5 both exist, ignoring malformed keys", () => {
    const s = symbol({ a0d0: a, a0d4: b, a0d5: c, junk5: d });
    expect(pickVariant(s, "light", "ltr")).toBe(b);
    expect(pickVariant(s, "light", "rtl")).toBe(c);
    expect(pickVariant(symbol({ a0d0: a, junk4: b, junk5: c }), "light", "rtl")).toBe(a);
  });
  it("combines dark and rtl, falling back when the pair is missing", () => {
    const s = symbol({ a0d4: a, a0d5: b, a1d4: c, a1d5: d }, "a0d4");
    expect(pickVariant(s, "dark", "rtl")).toBe(d);
    expect(pickVariant(symbol({ a0d4: a, a0d5: b, a1d4: c }, "a0d4"), "dark", "rtl")).toBe(b);
  });
});

describe("scale (Docs/format/01 section 5.4)", () => {
  const only = symbol({ a0d0: variant() });
  it("defaults to medium", () => {
    const { scale: _s, ...noScale } = ro();
    expect(buildSvg(only, noScale)).toEqual(buildSvg(only, ro({ scale: "medium" })));
  });
  it("box: the glyph is scaled by S about the origin and still fills the same box", () => {
    const r = buildSvg(only, ro({ scale: "medium" })).root;
    expect(r.attrs.viewBox).toBe("0 -3.19 12.76 12.76");
    expect(r.attrs.width).toBe(24);
    expect(r.attrs.height).toBe(24);
    expect(find(r, "g").find((g) => g.attrs.transform)!.attrs.transform).toBe("matrix(1.276 0 0 1.276 0 0)");
    const large = buildSvg(only, ro({ scale: "large" })).root;
    expect(large.attrs.viewBox).toBe("0 -4.1175 16.47 16.47");
    expect(large.attrs.width).toBe(24);
  });
  it("text: the viewBox scaled by S, the baseline at S·b + K·(S − 1)·X", () => {
    // size 34 / referencePointSize 17 = 2; baselineOffset 3.
    const small = buildSvg(only, ro({ layout: "text", size: 34, scale: "small" })).root;
    expect(small.attrs.style).toBe("vertical-align: -6px");
    for (const scale of ["medium", "large"] as const) {
      const S = SCALE_SIZE[scale];
      const r = buildSvg(only, ro({ layout: "text", size: 34, scale })).root;
      expect(r.attrs.width).toBeCloseTo(20 * S, 3);
      expect(r.attrs.height).toBeCloseTo(10 * S, 3);
      expect(r.attrs.style).toBe(`vertical-align: ${formatSignificant(-(S * 3 + BASELINE_K * (S - 1) * 17) * 2)}px`);
    }
  });
});

describe("locales (Docs/format/05 section 4.3)", () => {
  const base = variant({ ops: "Z" });
  const ar = variant({ ops: "ZZ" });
  const hans = variant({ ops: "ZZZ" });
  const hant = variant({ ops: "ZZZZ" });
  const hiL = variant({ ops: "MZ" });
  const hiR = variant({ ops: "MMZ" });
  const he = variant({ ops: "MMMZ" });
  const s: SymbolData = {
    ...symbol({ a0d0: base }),
    locales: { ar: { a0d0: ar }, "zh-Hant": { a0d0: hant }, "zh-Hans": { a0d0: hans }, hi: { a0d4: hiL, a0d5: hiR }, he: { a1d3: he } },
  };
  it("resolves the exact tag, case-insensitively", () => {
    expect(resolveLocale(s, "ar")).toBe("ar");
    expect(resolveLocale(s, "AR")).toBe("ar");
    expect(resolveLocale(s, "zh-hant")).toBe("zh-Hant");
    expect(resolveLocale(s, "zh_Hant")).toBe("zh-Hant");
    expect(pickVariant(s, "light", "ltr", "zh-Hant")).toBe(hant);
  });
  it("then a shorter prefix down to the language subtag", () => {
    expect(resolveLocale(s, "ar-EG")).toBe("ar");
    expect(resolveLocale(s, "zh-Hant-TW")).toBe("zh-Hant");
    expect(pickVariant(s, "light", "ltr", "ar-EG")).toBe(ar);
  });
  it("then the first stored tag, sorted, with the requested language", () => {
    expect(resolveLocale(s, "zh")).toBe("zh-Hans");
    expect(resolveLocale(s, "zh-TW")).toBe("zh-Hans");
    expect(pickVariant(s, "light", "ltr", "zh")).toBe(hans);
  });
  it("else the base drawing", () => {
    expect(resolveLocale(s, "fr-FR")).toBeUndefined();
    expect(resolveLocale(s, "")).toBeUndefined();
    expect(resolveLocale(s, undefined)).toBeUndefined();
    expect(pickVariant(s, "light", "ltr", "fr")).toBe(base);
    expect(pickVariant(s, "light", "ltr")).toBe(base);
    expect(pickVariant(symbol({ a0d0: base }), "light", "ltr", "ar")).toBe(base);
  });
  it("picks direction and appearance within the locale's set", () => {
    expect(pickVariant(s, "light", "ltr", "hi")).toBe(hiL);
    expect(pickVariant(s, "light", "rtl", "hi-IN")).toBe(hiR);
    // The set lacks a1d0: its own a0d0.
    expect(pickVariant(s, "dark", "rtl", "ar")).toBe(ar);
  });
  it("falls back to the base set when the locale's set has none of the keys", () => {
    expect(pickVariant(s, "light", "ltr", "he")).toBe(base);
  });
  it("buildSvg draws the localized variant", () => {
    const one = (args: number[]) =>
      variant({ ops: "ML", argCounts: [2, 2], masters: { 4: { ...master([0, 0, 10, 5]), args } }, layers: [layer([0, 2])] });
    const d = symbol({ a0d0: one([0, 0, 1, 1]) });
    d.locales = { ar: { a0d0: one([0, 0, 3, 3]) } };
    const path = (locale?: string) => find(buildSvg(d, ro(locale === undefined ? {} : { locale })).root, "path")[0]!.attrs.d;
    expect(path()).toBe("M0 0L1 1");
    expect(path("ar-SA")).toBe("M0 0L3 3");
  });
});
