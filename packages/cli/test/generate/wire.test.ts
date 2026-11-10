// Format 2: what `generate` writes, checked against `decodeSymbol` (core), its committed inverse.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeSymbol, type SymbolData } from "@opensymbols/core";
import { openCatalogDir } from "../../src/catalog-dir.js";
import { encodeSymbol } from "../../src/generate/encode.js";
import { buildPalette } from "../../src/generate/stand-in-palette.js";
import { deltaArgs, toWire } from "../../src/generate/wire.js";
import { allMasters, allMastersWithoutMetrics, P_MLZ, P_MZ, writeCatalog } from "./fixture.js";

const tmp = mkdtempSync(join(tmpdir(), "opensymbols-wire-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const catalog = openCatalogDir(
  writeCatalog(join(tmp, "c"), {
    facets: [
      ["plain", (id) => allMasters(id, () => [{ d: P_MLZ }])],
      ["knockout", (id) => allMasters(id, () => [{ d: P_MLZ }, { d: P_MZ, knockout: true }])],
      ["bare", (id) => allMastersWithoutMetrics(id, () => [{ d: P_MLZ }])],
      [
        "localized",
        (id) => [
          ...allMasters(id, () => [{ d: P_MLZ }]),
          ...allMasters(id, () => [{ d: P_MZ }]).map((r) => ({ ...r, key: { ...r.key, 13: 7 } })),
        ],
      ],
    ],
    localizations: { ar: 7 },
  }),
);
const opts = { masters: "all", palette: buildPalette(undefined), validated: false } as const;
const encoded = (): SymbolData[] => catalog.symbols().map((e) => encodeSymbol(catalog, e, opts));

describe("toWire (format 2)", () => {
  it("decodeSymbol(toWire(data)) is the data encode built, for every fixture symbol", () => {
    const all = encoded();
    expect(all.some((d) => d.locales !== undefined)).toBe(true);
    for (const data of all) expect(decodeSymbol(toWire(data))).toEqual(data);
  });

  it("drops argCounts and the defaults, and delta-encodes the args", () => {
    const data = encoded().find((d) => d.name === "knockout")!;
    const wire = toWire(data);
    expect(wire.v).toBe(2);
    const v = wire.variants.a0d0!;
    expect(v).not.toHaveProperty("argCounts");
    // M 3 5 L 1 2 Z then M 1 1 Z: d[i] = a[i] - a[i - 2].
    expect(data.variants.a0d0!.masters[4]!.args).toEqual([3, 5, 1, 2, 1, 1]);
    expect(v.masters[4]!.args).toEqual([3, 5, -2, -3, 0, -1]);
    // Layer 0 is opaque and does not clear: nothing but the paint.
    expect(v.layers[0]!.modes.monochrome).toEqual({ paint: { kind: "tint" } });
    expect(v.layers[1]!.modes.monochrome).toEqual({ paint: { kind: "tint" }, clearBehind: true });
    // No tags, keyframes or attachments; the non-default keys stay.
    const anim = v.layers[0]!.anim!;
    for (const k of ["tags", "strokeKeyframes", "attachments", "alwaysRotates", "alwaysPulses"]) expect(anim).not.toHaveProperty(k);
    expect(anim).toHaveProperty("familyLayer");
    expect(JSON.stringify(wire)).not.toContain('"opacity":1');
  });

  it("keeps a non-default style and anim value", () => {
    const data = encoded().find((d) => d.name === "plain")!;
    const layer = data.variants.a0d0!.layers[0]!;
    layer.modes.hierarchical.opacity = 0.5;
    layer.anim = { ...layer.anim, alwaysPulses: true, tags: ["a"] };
    const wire = toWire(data).variants.a0d0!.layers[0]!;
    expect(wire.modes.hierarchical.opacity).toBe(0.5);
    expect(wire.anim).toMatchObject({ alwaysPulses: true, tags: ["a"] });
    expect(decodeSymbol(toWire(data))).toEqual(data);
  });

  it("deltaArgs: integers come back exactly; 3-decimal args without drift along a long path", () => {
    const ints = Array.from({ length: 5000 }, (_, i) => ((i * 7919) % 4001) - 2000);
    const back = (d: number[]) => {
      const a = d.slice();
      for (let i = 2; i < a.length; i++) a[i] = a[i]! + a[i - 2]!;
      return a;
    };
    expect(back(deltaArgs(ints))).toEqual(ints);
    const decimals = ints.map((n) => Math.round(n * 1.37) / 1000);
    const rebuilt = back(deltaArgs(decimals));
    for (let i = 0; i < decimals.length; i++) expect(Math.abs(rebuilt[i]! - decimals[i]!)).toBeLessThan(1e-9);
  });
});
