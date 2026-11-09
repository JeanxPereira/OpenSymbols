import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppMetadata, loadBundleMetadata } from "../src/metadata.js";

const root = process.env.SF_CATALOG_DIR;

const readDir = (dir: string): Map<string, Uint8Array> => {
  const out = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    out.set(name, new Uint8Array(readFileSync(join(dir, name))));
  }
  return out;
};

// Reads the real metadata files; skipped (with this reason) when SF_CATALOG_DIR is unset.
describe.skipIf(!root)("public metadata (SF_CATALOG_DIR)", () => {
  it("has 9,524 public names and 32 categories (Docs/format/05 §2)", () => {
    const m = loadBundleMetadata(readDir(join(root as string, "public")));
    expect(m.availability.size).toBe(9524);
    expect(m.categories.length).toBe(32);
    expect(m.order.length).toBe(8526);
  });

  it("app files load without error (Docs/format/05 §3)", () => {
    const m = loadAppMetadata(readDir(join(root as string, "app")));
    expect(m.baseSymbols.size).toBe(1812);
    expect(m.layersetAvailability.size).toBe(6593);
  });
});
