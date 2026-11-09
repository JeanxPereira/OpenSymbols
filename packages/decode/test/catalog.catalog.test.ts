import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathToSvg } from "../src/bvg/path.js";
import { Catalog } from "../src/catalog.js";

const root = process.env.SF_CATALOG_DIR;

const readDir = (dir: string): Map<string, Uint8Array> => {
  const out = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) out.set(f.name, new Uint8Array(readFileSync(join(dir, f.name))));
  }
  return out;
};

// Reads the real catalog; skipped (with this reason) when SF_CATALOG_DIR is unset.
describe.skipIf(!root)("Catalog on the real catalog (SF_CATALOG_DIR)", () => {
  const open = () =>
    Catalog.open({
      car: new Uint8Array(readFileSync(join(root as string, "public", "Assets.car"))),
      bundleFiles: readDir(join(root as string, "public")),
      appFiles: readDir(join(root as string, "app")),
    });

  it("reads wifi metrics and the catalog header (01 section 3.1, 06 section 9.1)", () => {
    const c = open();
    expect(c.metrics("wifi", 4).referencePointSize).toBeGreaterThan(0);
    expect(c.header).toEqual({ coreuiVersion: 1010, renditionCount: 157938 });
    expect(c.skipped.renditions).toBe(0);
    for (const m of [1, 4, 9] as const) {
      expect(c.metrics("wifi", m).referencePointSize).toBeGreaterThan(0);
    }
  });

  it("has 8,527 symbols and 1,317 localized variants (05 section 4.3)", () => {
    const c = open();
    expect(c.symbols().length).toBe(8527);
    expect(c.symbols().filter((s) => s.localizedVariantOf).length).toBe(1317);
  });

  it("draws wifi (03 section 5.1)", () => {
    const c = open();
    const expected = [0, 0, 10.968744, 7.959957];
    c.drawing("wifi", 1).viewBox.forEach((v, i) =>
      expect(Math.abs(v - (expected[i] as number))).toBeLessThan(1e-9),
    );
    expect(Math.abs((c.drawing("wifi", 4).viewBox[2] as number) - 11.30517)).toBeLessThan(1e-9);
    const svgs = c.drawing("wifi", 1).layers.map((l) => pathToSvg(l.path));
    expect(svgs.some((s) => s.startsWith("m184 -891c38 37 93 32"))).toBe(true);
  });

  it("enumerates 31,029 vector renditions (01 section 5.1)", () => {
    expect([...open().documents()].length).toBe(31029);
  });
});
