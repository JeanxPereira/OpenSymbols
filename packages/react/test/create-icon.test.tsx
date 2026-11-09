import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LayerData, SymbolData, VariantData } from "@opensymbols/core";
import { createIcon } from "../src/index.js";

const layer = (cmd: [number, number], clearBehind = false): LayerData => {
  const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind };
  return { cmd, role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 };
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

const symbol = (name: string, layers: LayerData[]): SymbolData => ({
  v: 1,
  name,
  palette: "apple",
  variants: { a0d0: variant(layers) },
  defaultVariant: "a0d0",
  modes: ["monochrome"],
  build: { validated: true },
});

const plain = symbol("wifi", [layer([0, 2])]);
const knock = symbol("knock", [layer([0, 2]), layer([2, 5], true)]);

describe("createIcon", () => {
  it("renders a decorative 24px currentColor icon by default", () => {
    const Icon = createIcon(plain);
    const html = renderToStaticMarkup(<Icon />);
    expect(html).toContain('width="24"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("data-approximate");
  });

  it("title gives role=img and a <title>", () => {
    const Icon = createIcon(plain);
    const html = renderToStaticMarkup(<Icon title="Wi-Fi" />);
    expect(html).toContain('role="img"');
    expect(html).toContain("<title>Wi-Fi</title>");
    expect(html).not.toContain("aria-hidden");
  });

  it("two knockout icons in one tree get distinct mask ids", () => {
    const A = createIcon(knock);
    const B = createIcon(knock);
    const html = renderToStaticMarkup(
      <div>
        <A />
        <B />
      </div>,
    );
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const id of ids) expect(html).toContain(`url(#${id})`);
  });

  it("flags approximations", () => {
    const Icon = createIcon(plain);
    const html = renderToStaticMarkup(<Icon weight="semibold" />);
    expect(html).toContain('data-approximate="true"');
    // Only the regular master is stored: semibold has no master to draw from.
    expect(html).toContain('data-approximations="weight-unavailable"');
    const text = renderToStaticMarkup(<Icon layout="text" mode="palette" />);
    expect(text).toContain('data-approximations="mode text-layout"');
    const Unvalidated = createIcon({ ...plain, build: { validated: false } });
    expect(renderToStaticMarkup(<Icon />)).not.toContain("data-approximate");
    expect(renderToStaticMarkup(<Unvalidated />)).toContain('data-approximations="build"');
  });

  it("passes className, style and handlers through; width is ignored", () => {
    const Icon = createIcon(plain);
    const html = renderToStaticMarkup(
      <Icon className="c" style={{ color: "red" }} onClick={() => {}} width={99} aria-label="x" />,
    );
    expect(html).toContain('class="c"');
    expect(html).toContain("color:red");
    expect(html).toContain('width="24"');
    expect(html).not.toContain('width="99"');
    expect(html).toContain('aria-label="x"');
  });

  it("text layout turns the style string into a style object", () => {
    const Icon = createIcon(plain);
    expect(renderToStaticMarkup(<Icon layout="text" />)).toContain("vertical-align:");
  });

  it("camelCases SVG attributes", () => {
    const Icon = createIcon(symbol("o", [{ ...layer([0, 2]), modes: { ...layer([0, 2]).modes, monochrome: { paint: { kind: "tint" }, opacity: 0.5, clearBehind: false } } }]));
    expect(renderToStaticMarkup(<Icon />)).toContain('fill-opacity="0.5"');
  });

  it("explicit direction=rtl renders without error and SSR auto renders ltr", () => {
    const Icon = createIcon(plain);
    expect(renderToStaticMarkup(<Icon direction="rtl" />)).toContain("<svg");
    expect(renderToStaticMarkup(<div dir="rtl"><Icon /></div>)).toContain("<svg");
  });

  it("exposes metadata and a displayName", () => {
    const Icon = createIcon(plain);
    expect(Icon.symbolName).toBe("wifi");
    expect(Icon.data).toBe(plain);
    expect(Icon.displayName).toBe("Icon(wifi)");
  });

  it("throws on an unknown format version", () => {
    expect(() => createIcon({ ...plain, v: 2 } as unknown as SymbolData)).toThrow(TypeError);
  });
});
