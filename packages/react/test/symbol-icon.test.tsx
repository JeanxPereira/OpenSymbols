import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayerData, SymbolData, VariantData } from "@opensymbols/core";
import { SymbolIcon, createIcon } from "../src/index.js";

const layer = (cmd: [number, number], light?: string, clearBehind = false): LayerData => {
  const tint = { paint: { kind: "tint" as const }, opacity: 1, clearBehind };
  const mc = light
    ? { paint: { kind: "named" as const, name: "c", light, dark: light }, opacity: 1, clearBehind }
    : tint;
  return { cmd, role: "primary", modes: { monochrome: tint, hierarchical: tint, multicolor: mc, palette: tint }, motionGroup: 0 } as LayerData;
};
const variant = (layers: LayerData[]): VariantData => ({
  ops: "MLMLZ",
  argCounts: [2, 2, 2, 2, 0],
  masters: {
    4: {
      args: [0, 0, 1, 1, 0, 0, 2, 2],
      viewBox: [0, 0, 10, 5],
      transform: [1, 0, 0, 1, 0, 0],
      metrics: { referencePointSize: 17, baselineOffset: 3, capHeight: 10, leftInset: 0, rightInset: 0 },
    },
  },
  layers,
  variableValueMode: "color",
  vcContinuous: false,
});
const symbol = (layers: LayerData[]): SymbolData => ({
  v: 1,
  name: "fx",
  palette: "apple",
  variants: { a0d0: variant(layers) },
  defaultVariant: "a0d0",
  modes: ["monochrome", "multicolor"],
  build: { validated: true },
});

describe("SymbolIcon", () => {
  it("matches createIcon output", () => {
    const fixture = symbol([layer([0, 2])]);
    const Icon = createIcon(fixture);
    expect(renderToStaticMarkup(<SymbolIcon data={fixture} weight="bold" />)).toBe(renderToStaticMarkup(<Icon weight="bold" />));
  });
  it("has the expected display names and createIcon metadata", () => {
    const fixture = symbol([layer([0, 2])]);
    expect(SymbolIcon.displayName).toBe("SymbolIcon");
    const Icon = createIcon(fixture);
    expect(Icon.displayName).toBe("Icon(fx)");
    expect(Icon.symbolName).toBe("fx");
    expect(Icon.data).toBe(fixture);
  });
  it("renders a translucent named colour as fill + fill-opacity", () => {
    const html = renderToStaticMarkup(<SymbolIcon data={symbol([layer([0, 2], "#ff000080")])} mode="multicolor" />);
    expect(html).toContain('fill="#ff0000"');
    expect(html).toContain('fill-opacity="0.502"');
  });
  it("omits a #00000000 named colour on a non-knockout layer", () => {
    const html = renderToStaticMarkup(<SymbolIcon data={symbol([layer([0, 2], "#00000000")])} mode="multicolor" />);
    expect(html).not.toContain("<path");
  });
  it("scale: default medium; small draws the masters' own size; never in the DOM as an attribute", () => {
    const fixture = symbol([layer([0, 2])]);
    const def = renderToStaticMarkup(<SymbolIcon data={fixture} />);
    expect(def).toBe(renderToStaticMarkup(<SymbolIcon data={fixture} scale="medium" />));
    expect(def).toContain('viewBox="0 -3.19 12.76 12.76"');
    expect(def).toContain('transform="matrix(1.276 0 0 1.276 0 0)"');
    // A regular-only symbol at regular is exact at every scale.
    expect(def).not.toContain("data-approximate");
    expect(def).not.toContain("scale=");
    const small = renderToStaticMarkup(<SymbolIcon data={fixture} scale="small" />);
    expect(small).toContain('viewBox="0 -2.5 10 10"');
    expect(small).toContain('width="24"');
    const large = renderToStaticMarkup(<SymbolIcon data={fixture} scale="large" layout="text" size={17} />);
    expect(large).toContain('width="16.47"');
  });
  it("locale: picks the localized drawing, else the base; never in the DOM as an attribute", () => {
    const fixture = symbol([layer([0, 2])]);
    const ar = variant([layer([0, 2])]);
    ar.masters[4] = { ...ar.masters[4]!, args: [0, 0, 3, 3, 0, 0, 2, 2] };
    const data: SymbolData = { ...fixture, locales: { ar: { a0d0: ar } } };
    expect(renderToStaticMarkup(<SymbolIcon data={data} />)).toContain('d="M0 0L1 1"');
    const html = renderToStaticMarkup(<SymbolIcon data={data} locale="ar-EG" />);
    expect(html).toContain('d="M0 0L3 3"');
    expect(html).not.toContain("locale");
    expect(renderToStaticMarkup(<SymbolIcon data={data} locale="fr" />)).toContain('d="M0 0L1 1"');
  });
  it("throws on a version mismatch at render", () => {
    const bad = { ...symbol([layer([0, 2])]), v: 99 } as unknown as SymbolData;
    expect(() => renderToStaticMarkup(<SymbolIcon data={bad} />)).toThrow(TypeError);
  });
});
