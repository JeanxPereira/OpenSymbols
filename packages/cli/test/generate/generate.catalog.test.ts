import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
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
  });
});
