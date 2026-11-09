import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LayerData, SymbolData } from "@opensymbols/core";
import { deepImportLine, importLine, jsxFor, svgFor } from "../src/copy.js";
import { REASONS } from "../src/reasons.js";

const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind: false };
const layer = (cmd: [number, number], clearBehind = false): LayerData => {
  const s = { ...st, clearBehind };
  return { cmd, role: "primary", modes: { monochrome: s, hierarchical: s, multicolor: s, palette: s }, motionGroup: 0 };
};

/** Two layers, the second a knockout: the SVG carries a mask with a generated id. */
const fixture = {
  v: 1,
  name: "wifi",
  palette: "stand-in",
  variants: {
    a0d0: {
      ops: "MLLZMLLZ",
      argCounts: [2, 2, 2, 0, 2, 2, 2, 0],
      masters: {
        4: { args: [0, 0, 10, 0, 5, 10, 2, 2, 8, 2, 5, 8], viewBox: [0, 0, 10, 10], transform: [1, 0, 0, 1, 0, 0] },
      },
      layers: [layer([0, 4]), layer([4, 8], true)],
      variableValueMode: "color",
      vcContinuous: false,
    },
  },
  defaultVariant: "a0d0",
  modes: ["monochrome", "hierarchical"],
  build: { validated: true },
} as SymbolData;

describe("copy", () => {
  it("import lines", () => {
    expect(importLine("my-symbols", "Wifi")).toBe('import { Wifi } from "my-symbols";');
    expect(deepImportLine("my-symbols", "Wifi")).toBe('import Wifi from "my-symbols/Wifi";');
  });

  it("jsxFor keeps only non-default props, in a stable order", () => {
    expect(jsxFor("Wifi", { weight: "semibold", mode: "palette", palette: ["#f00"] })).toBe(
      '<Wifi weight="semibold" mode="palette" palette={["#f00"]} />',
    );
    expect(jsxFor("Wifi", { palette: ["#f00"], mode: "palette", weight: "semibold" })).toBe(
      '<Wifi weight="semibold" mode="palette" palette={["#f00"]} />',
    );
  });

  it("jsxFor omits defaults", () => {
    expect(
      jsxFor("Wifi", {
        size: 24,
        weight: "regular",
        mode: "monochrome",
        color: "currentColor",
        appearance: "light",
        layout: "box",
        direction: "auto",
      }),
    ).toBe("<Wifi />");
    expect(jsxFor("Wifi", { size: 48, weight: 5.5, variableValue: 0.5, direction: "rtl" })).toBe(
      '<Wifi size={48} weight={5.5} variableValue={0.5} direction="rtl" />',
    );
  });

  it("svgFor is a standalone SVG with stable ids", () => {
    const svg = svgFor(fixture, { size: 48, weight: "bold" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('id="os-k1"');
    expect(svg).toContain('mask="url(#os-k1)"');
    expect(svgFor(fixture, { size: 48, weight: "bold" })).toBe(svg);
  });

  it("reason texts match the README table", () => {
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const table = readme.slice(readme.indexOf("| reason |"));
    const end = table.indexOf("\n\n");
    const body = end === -1 ? table : table.slice(0, end);
    const rows = [...body.matchAll(/^\| `([a-z-]+)` \| (.+) \|$/gm)].map((m) => [m[1], m[2]]);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(Object.fromEntries(rows)).toEqual(REASONS);
  });
});
