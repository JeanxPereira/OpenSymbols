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
  it("throws on a version mismatch at render", () => {
    const bad = { ...symbol([layer([0, 2])]), v: 99 } as unknown as SymbolData;
    expect(() => renderToStaticMarkup(<SymbolIcon data={bad} />)).toThrow(TypeError);
  });
});
