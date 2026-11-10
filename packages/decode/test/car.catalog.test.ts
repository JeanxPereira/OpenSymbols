import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../src/car.js";

const root = process.env.SF_CATALOG_DIR;

// Reads the real CoreGlyphs catalog; skipped (with this reason) when SF_CATALOG_DIR is unset.
describe.skipIf(!root)("public/Assets.car (SF_CATALOG_DIR)", () => {
  const catalog = () =>
    AssetCatalog.open(new Uint8Array(readFileSync(join(root as string, "public", "Assets.car"))));

  it("has 8,527 facets (Docs/format/01 §1.1)", () => {
    expect(catalog().facets().size).toBe(8527);
  });

  it("skips nothing and counts 31,029 BVG vector renditions (§5.1, §6)", () => {
    const cat = catalog();
    expect(cat.skipped).toEqual({ facets: 0, renditions: 0, nonVector: 0, idEntries: 0, metrics: 0, raster: 2793 });
    let vectors = 0;
    for (const id of new Set(cat.facets().values())) {
      for (const r of cat.renditions(id)) {
        if (r.payload === null) continue;
        expect(String.fromCharCode(...r.payload.subarray(0, 4))).toBe("BVG ");
        vectors++;
      }
    }
    expect(vectors).toBe(31029);
  });

  it("wifi has three vector renditions at weights 1, 4 and 9, GlyphSize 1 (§5.2, §5.4)", () => {
    const cat = catalog();
    const vectors = cat
      .renditions(cat.facets().get("wifi")!)
      .filter((r) => r.payload !== null);
    expect(vectors).toHaveLength(3);
    expect(vectors.map((r) => r.key[26]).sort()).toEqual([1, 4, 9]);
    for (const r of vectors) expect(r.key[27]).toBe(1);
  });
});
