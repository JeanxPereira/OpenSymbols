import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { decodeSymbol } from "@opensymbols/core";
import { openCatalogDir } from "../../src/catalog-dir.js";
import { encodeSymbol } from "../../src/generate/encode.js";
import { moduleJson } from "../../src/generate/module-source.js";
import { buildPalette } from "../../src/generate/stand-in-palette.js";
import { toWire } from "../../src/generate/wire.js";
import { run } from "../../src/run.js";

const root = process.env.SF_CATALOG_DIR;
const OUT = resolve(import.meta.dirname, "..", "..", ".generated-test", "real");

// Generates the real catalog; skipped (with this reason) when SF_CATALOG_DIR is unset.
describe.skipIf(!root)("opensymbols generate on the real catalog (SF_CATALOG_DIR)", () => {
  afterAll(() => rmSync(OUT, { recursive: true, force: true }));

  it("writes a validated package and Wifi renders at three weights in every mode", { timeout: 600_000 }, async () => {
    rmSync(OUT, { recursive: true, force: true });
    let err = "";
    const code = run(["generate", "--catalog", root as string, "--out", OUT], {}, {
      out: () => {},
      err: (s) => (err += s),
    });
    const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));
    console.log(`skipped=${index.skipped.length}\n${err}`);
    expect(code).toBe(0);
    expect(index.build.validated).toBe(true);
    expect(index.localized).toHaveLength(1317);
    // 8,527 facets: 1,317 localized and _gradient.highlegibility, which has no vector (01 §3.10).
    expect(index.skipped).toEqual([]);
    expect(index.symbols).toHaveLength(8527 - 1317 - 1);

    const Wifi = (await import(pathToFileURL(join(OUT, "symbols", "Wifi.js")).href)).default;
    for (const weight of ["ultralight", "regular", "black"] as const) {
      for (const mode of ["monochrome", "hierarchical", "multicolor", "palette"] as const) {
        const html = renderToStaticMarkup(createElement(Wifi, { weight, mode }));
        expect(html).toContain('<path d="');
      }
    }

    // Format 2, no chunks; localized drawings in their base symbol (05 §4.3).
    expect(existsSync(join(OUT, "chunks"))).toBe(false);
    expect(readdirSync(join(OUT, "symbols")).every((f) => f.endsWith(".js"))).toBe(true);
    const wire = (component: string) =>
      JSON.parse(moduleJson(readFileSync(join(OUT, "symbols", `${component}.js`), "utf8")) as string);
    expect(Object.keys(wire("CharacterBookClosed").locales)).toEqual(expect.arrayContaining(["zh-Hans", "zh-Hant", "ja", "ko"]));
    expect(Object.keys(wire("Sf01Circle").locales)).toEqual(expect.arrayContaining(["ar", "hi", "ur"]));
    expect(err).toContain("localized: 1615 localized drawings across 391 symbols;");
    // In this build every localized facet repeats a token-13 rendition of its base (which wins), and
    // every `.rtl` facet's base has its own Direction 5: no facet adds a drawing.
    expect(index.localized.filter((l: { became: string[] }) => l.became.length > 0)).toEqual([]);
  });

  it("format 2 decodes back to what encode built (decodeSymbol ∘ toWire), on a sample of real symbols", { timeout: 600_000 }, () => {
    const catalog = openCatalogDir(root as string);
    const opts = { masters: "all", palette: buildPalette(undefined), validated: true } as const;
    const entries = catalog.symbols().filter((e) => e.drawable && e.localizedVariantOf === undefined);
    const sample = entries.filter((e, i) => i % 40 === 0 || catalog.localizationsOf(e.name).size > 0).slice(0, 600);
    expect(sample.length).toBeGreaterThan(300);
    for (const e of sample) {
      const data = encodeSymbol(catalog, e, opts);
      expect(decodeSymbol(toWire(data))).toEqual(data);
    }
  });
});
