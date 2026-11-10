import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { run } from "../src/run.js";
import { buildBvg, LIST_0_0_3_5, PATH_Z, type NodeSpec } from "../../decode/test/helpers/build-bvg.js";
import { buildCar, type RenditionSpec } from "../../decode/test/helpers/build-car.js";
import { buildBplist } from "../../decode/test/helpers/build-plist.js";
import { buildStyle } from "../../decode/test/helpers/build-style.js";

// Atoms (Docs/format/02 section 3).
const SVG = 0, G = 1, VIEWBOX = 2, PATH = 3, D = 22, TRANSFORM = 21, ZERO = 31;
const MOTION_GROUP = 34, DEFAULTS = 52, VALUE_MODE = 39, DRAW_REVERSES = 38, COLOR = 49, FALSE = 54;
const ID_S = 63, MONO = 0x80, MULTI = 0x81, HIER = 0x82, NO_VALUE = 0xff, TINT = 86, PRIMARY = 55;

/** A document buildDrawing accepts: one layer holding one path. */
const validDoc = (): Uint8Array => {
  const g: NodeSpec = {
    tag: G,
    attrs: [{ name: TRANSFORM, value: 91 }],
    children: [{ tag: PATH, attrs: [{ name: D, value: 90 }], classes: [1, 2, 3] }],
  };
  return buildBvg({
    typeCode: 0x11,
    localStrings: [LIST_0_0_3_5, PATH_Z, "matrix(1 0 0 1 0 0)"],
    idPairs: [{ stringIndex: ID_S, target: g }],
    root: { tag: SVG, attrs: [{ name: VIEWBOX, value: 89 }], children: [g] },
    style: buildStyle({
      indexWidth: 1,
      offsetWidth: 1,
      classes: [
        { kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 },
        { kind: MONO, layer: 0, value: NO_VALUE, rule: 1 },
        { kind: MULTI, layer: 0, value: TINT, rule: 1 },
        { kind: HIER, layer: 0, value: PRIMARY, rule: 1 },
      ],
      rules: [
        [
          { property: VALUE_MODE, values: [COLOR] },
          { property: DRAW_REVERSES, values: [FALSE] },
        ],
        [{ property: MOTION_GROUP, values: [ZERO] }],
      ],
    }),
  });
};

const tmp = mkdtempSync(join(tmpdir(), "opensymbols-run-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Writes a catalog root under tmp/<name> and returns its path. */
const writeCatalog = (name: string, renditions: RenditionSpec[]): string => {
  const root = join(tmp, name);
  mkdirSync(join(root, "public"), { recursive: true });
  writeFileSync(
    join(root, "public", "Assets.car"),
    buildCar({ keyFormat: [4, 7, 13, 17, 26], facets: { a: 1 }, localizations: {}, appearances: {}, renditions }),
  );
  const files: Record<string, Uint8Array> = {
    "name_availability.plist": buildBplist({ symbols: { a: "2019" }, year_to_release: { "2019": { iOS: "13.0" } } }),
    "name_aliases.strings": buildBplist({}),
    "symbol_categories.plist": buildBplist({}),
    "symbol_search.plist": buildBplist({}),
  };
  for (const [f, bytes] of Object.entries(files)) writeFileSync(join(root, "public", f), bytes);
  return root;
};

const exec = (argv: string[], env: Record<string, string | undefined> = {}) => {
  let out = "";
  let err = "";
  const code = run(argv, env, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
};

const masters = (payload: () => Uint8Array): RenditionSpec[] =>
  [1, 4, 9].map((m) => ({ key: { 17: 1, 26: m }, payload: payload() }));

describe("run exit codes", () => {
  it("gate exits 2 naming both sources when no catalog is given", () => {
    const r = exec(["gate"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--catalog");
    expect(r.err).toContain("SF_CATALOG_DIR");
  });

  it("gate exits 2 naming the path and the expected layout when Assets.car is missing", () => {
    const r = exec(["gate", "--catalog", join(tmp, "nowhere")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Assets.car");
    expect(r.err).toContain("CoreGlyphs.bundle/Contents/Resources");
    expect(r.err).toContain("app/");
  });

  it("an unknown flag is a usage error: exit 2", () => {
    const r = exec(["gate", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--bogus");
  });

  it("gate on a clean catalog exits 0 and prints the summary line", () => {
    const root = writeCatalog("clean", masters(validDoc));
    const r = exec(["gate", "--catalog", root]);
    expect(r.out).toBe("documents=3 failures=0 incompatible=0 skipped=0\n");
    expect(r.code).toBe(0);
  });

  it("gate reads $SF_CATALOG_DIR", () => {
    const root = writeCatalog("env", masters(validDoc));
    expect(exec(["gate"], { SF_CATALOG_DIR: root }).code).toBe(0);
  });

  it("gate exits non-zero when a record was skipped", () => {
    const root = writeCatalog("skipped", [
      ...masters(validDoc),
      { key: { 17: 1, 26: 4, 7: 1 }, rawPayload: new TextEncoder().encode("%PDF-1.7") },
    ]);
    const r = exec(["gate", "--catalog", root]);
    expect(r.out).toBe("documents=3 failures=0 incompatible=0 skipped=1\n");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/SKIPPED RENDITIONS\[3\]: .*not DWAR/);
  });

  it("gate counts MLEC rasters in a note, not as skipped records (Docs/format/01 §3.10)", () => {
    const root = writeCatalog("raster", [
      ...masters(validDoc),
      { key: { 17: 1, 26: 4, 7: 1 }, layout: 1004, rawPayload: new TextEncoder().encode("MLEC\0\0\0\0") },
    ]);
    const r = exec(["gate", "--catalog", root]);
    expect(r.out).toBe("documents=3 failures=0 incompatible=0 skipped=0\n");
    expect(r.code).toBe(0);
    expect(r.err).toContain("note: raster=1 (MLEC bitmaps beside the vectors, not drawn)");
  });

  it("gate prints a localized note, grouped failures and incompatible reasons", () => {
    const root = writeCatalog("grouped", [
      { key: { 17: 1, 26: 4 }, payload: new Uint8Array([1, 2, 3]) },
      { key: { 17: 1, 26: 9 }, payload: new Uint8Array([1, 2, 3]) },
    ]);
    const r = exec(["gate", "--catalog", root]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^documents=2 failures=2 incompatible=1 skipped=0\n$/);
    expect(r.err).toContain("note: localized=0");
    const fails = r.err.split("\n").filter((l) => l.startsWith("FAIL"));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/^FAIL 2x ByteReader: .* \[a\]$/);
    expect(r.err).toMatch(/INCOMPATIBLE a: master 1: /);
  });

  it("dump --all exits non-zero naming the document when one fails to decode", () => {
    const root = writeCatalog("broken", [
      { key: { 17: 1, 26: 4 }, payload: validDoc() },
      { key: { 17: 1, 26: 9 }, payload: new Uint8Array([1, 2, 3]) },
    ]);
    const out = join(tmp, "broken.dump.txt");
    writeFileSync(out, "previous baseline\n");
    const r = exec(["dump", "--all", "--out", out, "--catalog", root]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('dump failed for "a"');
    // Streamed to FILE.tmp and renamed only on success: no partial file is left.
    expect(readFileSync(out, "utf8")).toBe("previous baseline\n");
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });

  it("dump --all exits 0 on a clean catalog and writes every document", () => {
    const root = writeCatalog("dumpok", masters(validDoc));
    const out = join(tmp, "ok.dump.txt");
    expect(exec(["dump", "--all", "--out", out, "--catalog", root]).code).toBe(0);
    expect(readFileSync(out, "utf8").match(/^== a key=/gm)).toHaveLength(3);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });
});
