// @vitest-environment happy-dom
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { LayerData, SymbolData, VariantData } from "@opensymbols/core";
import { createIcon } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layer = (): LayerData => {
  const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind: false };
  return { cmd: [0, 2], role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 };
};
const variant = (x: number): VariantData => ({
  ops: "MLZ",
  argCounts: [2, 2, 0],
  masters: {
    4: {
      args: [x, 0, 1, 1],
      viewBox: [0, 0, 10, 5],
      transform: [1, 0, 0, 1, 0, 0],
      metrics: { referencePointSize: 17, baselineOffset: 3, capHeight: 10, leftInset: 0, rightInset: 0 },
    },
  },
  layers: [layer()],
  variableValueMode: "color",
  vcContinuous: false,
});
const data: SymbolData = {
  v: 1,
  name: "dir",
  palette: "apple",
  variants: { a0d0: variant(0), a0d4: variant(4), a0d5: variant(5) },
  defaultVariant: "a0d0",
  modes: ["monochrome"],
  build: { validated: true },
};
const Icon = createIcon(data);

let host: HTMLElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});

async function mount(ui: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host!).render(ui);
  });
  return host;
}
const d = (h: HTMLElement) => h.querySelector("path")!.getAttribute("d");

describe("client behaviour", () => {
  it("auto follows an rtl ancestor after mount", async () => {
    const rtl = await mount(<div dir="rtl"><Icon /></div>);
    expect(d(rtl)).toMatch(/^M5 /);
    rtl.remove();
    const ltr = await mount(<div dir="ltr"><Icon /></div>);
    expect(d(ltr)).toMatch(/^M4 /);
  });

  it("direction=ltr ignores an rtl ancestor", async () => {
    const h = await mount(<div dir="rtl"><Icon direction="ltr" /></div>);
    expect(d(h)).toMatch(/^M4 /);
  });

  it("function and object refs receive the svg", async () => {
    let got: SVGSVGElement | null = null;
    const obj = createRef<SVGSVGElement>();
    await mount(<><Icon ref={(el) => { got = el; }} /><Icon ref={obj} /></>);
    expect(got).toBeInstanceOf(SVGSVGElement);
    expect(obj.current?.tagName.toLowerCase()).toBe("svg");
  });
});
