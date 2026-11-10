import { describe, expect, it } from "vitest";
import { openCatalogDir } from "../src/catalog-dir.js";
import { runGate } from "../src/gate.js";

const root = process.env.SF_CATALOG_DIR;

// Reads the real catalog; skipped (with this reason) when SF_CATALOG_DIR is unset.
describe.skipIf(!root)("runGate on the real catalog (SF_CATALOG_DIR)", () => {
  // Reads and decodes the whole catalog: seconds alone, longer beside the rest of the suite.
  it("decodes all 31,029 documents with compatible masters", { timeout: 120_000 }, () => {
    const r = runGate(openCatalogDir(root as string));
    expect(r.documents).toBe(31029);
    expect(r.failures).toEqual([]);
    expect(r.incompatibleMasters).toEqual([]);
  });
});
