import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LayerData, SymbolData } from "@opensymbols/core";
import { deepImportLine, importLine, jsxFor, replaceImportLines, replaceJsxFor, svgFor } from "../src/copy.js";
import { buildEffect } from "../src/effects.js";
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

  it("jsxFor writes the effect with only its non-default options and the companion prop", () => {
    // discrete: a trigger placeholder
    expect(jsxFor("Bell", { effect: { kind: "bounce" } })).toBe('<Bell effect={{ kind: "bounce" }} trigger={count /* each change plays it */} />');
    // defaults left out: speed 1, byLayer true, false flags, repeat once
    expect(
      jsxFor("Bell", { effect: { kind: "draw", speed: 1, byLayer: true, reversed: true, drawIndividually: false, repeat: undefined } as never }),
    ).toBe('<Bell effect={{ kind: "draw", reversed: true }} trigger={count /* each change plays it */} />');
    // continuous: `active`, and `repeat` is not written (active always runs continuously)
    expect(jsxFor("Wifi", { size: 48, effect: { kind: "pulse", byLayer: false, speed: 0.5, repeat: "continuous" } })).toBe(
      '<Wifi size={48} effect={{ kind: "pulse", byLayer: false, speed: 0.5 }} active={active} />',
    );
    // transitions: `visible`
    expect(jsxFor("Wifi", { effect: { kind: "disappear", direction: "down" } })).toBe(
      '<Wifi effect={{ kind: "disappear", direction: "down" }} visible={visible} />',
    );
    expect(jsxFor("Arrow", { effect: { kind: "rotate", rotateDirection: "counterClockwise" } })).toBe(
      '<Arrow effect={{ kind: "rotate", rotateDirection: "counterClockwise" }} trigger={count /* each change plays it */} />',
    );
  });

  it("buildEffect drops Reverse order unless the Draw is reversed (Draw Off only)", () => {
    expect(buildEffect("draw", { drawReversedOrder: true }, 1, "once")).toEqual({ kind: "draw" });
    expect(buildEffect("draw", { reversed: true, drawReversedOrder: true }, 1, "once")).toEqual({ kind: "draw", reversed: true, drawReversedOrder: true });
  });

  it("replaceJsxFor: the Replace snippet with both components, show, style, magic and the icon props", () => {
    expect(replaceJsxFor("PlayFill", "PauseFill", { size: 32, weight: "bold" }, { style: "upUp", magic: true, speed: 2 })).toBe(
      '<Replace from={PlayFill} to={PauseFill} show={playing ? "to" : "from"} style="upUp" magic speed={2} size={32} weight="bold" />',
    );
    expect(replaceJsxFor("A", "B", {}, { style: "downUp", magic: false, speed: 1 })).toBe(
      '<Replace from={A} to={B} show={playing ? "to" : "from"} style="downUp" />',
    );
    expect(replaceImportLines("my-symbols", "A", "B")).toBe('import { A, B } from "my-symbols";\nimport { Replace } from "@opensymbols/animate/react";');
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
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const table = readme.slice(readme.indexOf("| reason |"));
    const end = table.indexOf("\n\n");
    const body = end === -1 ? table : table.slice(0, end);
    const rows = [...body.matchAll(/^\| `([a-z-]+)` \| (.+) \|$/gm)].map((m) => [m[1], m[2]]);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(Object.fromEntries(rows)).toEqual(REASONS);
  });
});
