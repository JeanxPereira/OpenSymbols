import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { openCatalogDir } from "../../src/catalog-dir.js";
import { generate } from "../../src/generate/index.js";
import { run } from "../../src/run.js";
import { buildBplist } from "../../../decode/test/helpers/build-plist.js";
import { allMasters, allMastersWithoutMetrics, P_MLLZ, P_MLZ, P_MZ, writeCatalog } from "./fixture.js";

const tmp = mkdtempSync(join(tmpdir(), "opensymbols-generate-"));
// Inside the workspace, so the generated modules resolve @opensymbols/react and react.
const GENERATED = resolve(import.meta.dirname, "..", "..", ".generated-test");
const outs: string[] = [];
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const o of outs) rmSync(o, { recursive: true, force: true });
});

const newOut = (): string => {
  mkdirSync(GENERATED, { recursive: true });
  const o = mkdtempSync(join(GENERATED, "t-"));
  rmSync(o, { recursive: true });
  outs.push(o);
  return o;
};

const exec = (argv: string[]) => {
  let out = "";
  let err = "";
  const code = run(argv, {}, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
};

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

const plain = (id: number) => allMasters(id, () => [{ d: P_MLZ }]);
const knockout = (id: number) => allMasters(id, () => [{ d: P_MLZ }, { d: P_MZ, knockout: true }]);
// The black master has one extra command: not point-compatible.
const incompatible = (id: number) => allMasters(id, (m) => [{ d: m === 9 ? P_MLLZ : P_MLZ }]);

const threeSymbols = writeCatalog(join(tmp, "three"), {
  facets: [
    ["plain.circle", plain],
    ["speaker.knockout", knockout],
    ["bad.masters", incompatible],
    ["plain.circle.rtl", plain],
  ],
  aliases: { "old.plain": "plain.circle", "old.bad": "bad.masters" },
});

describe("opensymbols generate", () => {
  const OUT = newOut();
  const r = exec(["generate", "--catalog", threeSymbols, "--out", OUT]);

  it("skips the incompatible symbol and, at 1 of 3 skipped (> 1%), exits 1 after writing", () => {
    expect(r.code).toBe(1);
    expect(r.err).toContain("generated 2 symbols");
    expect(r.err).toMatch(/skipped 1 symbol/);
    expect(r.err).toContain("bad.masters");
    expect(r.err).toContain("master 9 is not point-compatible");
    expect(r.err).toMatch(/more than 1%/);
    // The group line says what; each symbol line says only the rest.
    expect(r.err).toContain("  master 9 is not point-compatible with master 4 (1):\n");
    expect(r.err).toContain('    bad.masters: variant a0d0: layer 0 command 2: op "L", master 4 has "Z"\n');
    expect(existsSync(join(OUT, "index.json"))).toBe(true);
  });

  it("writes index.json: symbols, the build fingerprint, the palette and the localized facets", () => {
    const index = json(join(OUT, "index.json"));
    expect(index.formatVersion).toBe(1);
    expect(index.palette).toBe("stand-in");
    expect(index.build).toEqual({ coreuiVersion: 1010, renditionCount: 12, facetCount: 4, validated: false });
    expect(index.symbols.map((s: { name: string }) => s.name)).toEqual(["plain.circle", "speaker.knockout"]);
    expect(index.symbols[0]).toEqual({
      name: "plain.circle",
      component: "PlainCircle",
      aliases: ["old.plain"],
      categories: [],
      searchTerms: [],
      year: "2019",
      modes: ["monochrome", "hierarchical", "multicolor", "palette"],
      variableValue: false,
      approximate: ["palette", "build"],
      chunk: 0,
    });
    expect(index.skipped).toEqual([{ name: "bad.masters", reason: expect.stringContaining("master 9") }]);
    expect(index.localized).toEqual([{ name: "plain.circle.rtl", base: "plain.circle" }]);
  });

  it("warns on stderr that the build is not validated", () => {
    expect(r.err).toMatch(/warning: .*not .*validated/i);
  });

  it("writes a module and a declaration per symbol, and the index re-exports them and the aliases", () => {
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual([
      "PlainCircle.d.ts",
      "PlainCircle.js",
      "SpeakerKnockout.d.ts",
      "SpeakerKnockout.js",
    ]);
    const mod = readFileSync(join(OUT, "symbols", "PlainCircle.js"), "utf8");
    expect(mod).toMatch(
      /^"use client";\nimport \{ createIcon \} from "@opensymbols\/react";\nexport default \/\*#__PURE__\*\/createIcon\(\{"v":1,/,
    );
    expect(readFileSync(join(OUT, "index.js"), "utf8")).not.toContain("use client");
    expect(readFileSync(join(OUT, "symbols", "PlainCircle.d.ts"), "utf8")).toBe(
      'declare const C: import("@opensymbols/react").OpenSymbolIcon;\nexport default C;\n',
    );
    const lines = [
      'export { default as PlainCircle } from "./symbols/PlainCircle.js";',
      'export { default as SpeakerKnockout } from "./symbols/SpeakerKnockout.js";',
      'export { default as OldPlain } from "./symbols/PlainCircle.js";',
    ];
    expect(readFileSync(join(OUT, "index.js"), "utf8")).toBe(lines.join("\n") + "\n");
    expect(readFileSync(join(OUT, "index.d.ts"), "utf8")).toBe(lines.join("\n") + "\n");
  });

  it("writes chunks of SymbolData in index order and an installable package.json", () => {
    const chunk = json(join(OUT, "chunks", "0.json"));
    expect(chunk.map((s: { name: string }) => s.name)).toEqual(["plain.circle", "speaker.knockout"]);
    expect(readdirSync(join(OUT, "chunks"))).toEqual(["0.json"]);
    expect(json(join(OUT, "package.json"))).toEqual({
      name: "opensymbols-local",
      version: "0.0.0",
      private: true,
      type: "module",
      sideEffects: false,
      main: "index.js",
      types: "index.d.ts",
      exports: {
        ".": { types: "./index.d.ts", default: "./index.js" },
        "./index.json": "./index.json",
        "./chunks/*": "./chunks/*",
        "./*": { types: "./symbols/*.d.ts", default: "./symbols/*.js" },
      },
      peerDependencies: { "@opensymbols/react": "*", react: ">=19" },
    });
  });

  it("deep imports resolve through the exports map", () => {
    // Self-reference: inside the package, its own name resolves through its exports.
    const script = [
      'for (const s of ["opensymbols-local", "opensymbols-local/PlainCircle", "opensymbols-local/index.json", "opensymbols-local/chunks/0.json"])',
      "  console.log(import.meta.resolve(s));",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: OUT, encoding: "utf8" });
    const [root, deep, index, chunk] = out.trim().split(/\r?\n/);
    expect(root).toBe(pathToFileURL(join(OUT, "index.js")).href);
    expect(deep).toBe(pathToFileURL(join(OUT, "symbols", "PlainCircle.js")).href);
    expect(index).toBe(pathToFileURL(join(OUT, "index.json")).href);
    expect(chunk).toBe(pathToFileURL(join(OUT, "chunks", "0.json")).href);
  });

  it("every symbol carries the build's validation, and an unvalidated build renders flagged", async () => {
    for (const s of json(join(OUT, "chunks", "0.json"))) expect(s.build).toEqual({ validated: false });
    const PlainCircle = (await import(pathToFileURL(join(OUT, "symbols", "PlainCircle.js")).href)).default;
    expect(renderToStaticMarkup(createElement(PlainCircle))).toContain('data-approximations="build"');
  });

  it("the generated components render with react-dom/server", async () => {
    const PlainCircle = (await import(pathToFileURL(join(OUT, "symbols", "PlainCircle.js")).href)).default;
    const html = renderToStaticMarkup(createElement(PlainCircle, { weight: "black" }));
    expect(html).toContain("<svg");
    expect(html).toContain('<path d="');
    const index = await import(pathToFileURL(join(OUT, "index.js")).href);
    expect(Object.keys(index).sort()).toEqual(["OldPlain", "PlainCircle", "SpeakerKnockout"]);
    expect(index.OldPlain).toBe(index.PlainCircle);
    const knocked = renderToStaticMarkup(createElement(index.SpeakerKnockout, { mode: "monochrome" }));
    expect(knocked).toContain("<mask");
  });
});

describe("opensymbols generate: what index.json carries for the demo", () => {
  const root = writeCatalog(join(tmp, "demo"), {
    facets: [
      ["a.one", plain],
      ["b.two", plain],
      ["c.three", plain],
      ["d.four", plain],
    ],
    categories: [
      { key: "empty", icon: "x" },
      { key: "shapes", icon: "circle" },
      { key: "arrows", icon: "arrow.right" },
      { key: "labelled", icon: "tag" },
    ],
    symbolCategories: { "a.one": ["shapes"], "b.two": ["shapes", "arrows"], "c.three": ["labelled"], "d.four": [] },
    app: {
      "categories.plist": buildBplist([
        { key: "empty", icon: "x", label: "Empty" },
        { key: "shapes", icon: "circle", label: "Shapes and such" },
        { key: "arrows", icon: "arrow.right", label: "Arrows" },
      ]),
    },
  });
  const OUT = newOut();
  let index: any;
  beforeAll(() => {
    expect(exec(["generate", "--catalog", root, "--out", OUT, "--name", "demo-icons"]).code).toBe(0);
    index = json(join(OUT, "index.json"));
  });

  it("names the package", () => {
    expect(index.package).toEqual({ name: "demo-icons" });
  });

  it("lists categories in bundle order with app labels, counts of generated symbols, and none empty", () => {
    expect(index.categories).toEqual([
      { key: "shapes", label: "Shapes and such", icon: "circle", count: 2 },
      { key: "arrows", label: "Arrows", icon: "arrow.right", count: 1 },
      { key: "labelled", label: "labelled", icon: "tag", count: 1 },
    ]);
  });

  it("flags each symbol's variable value and approximations", () => {
    for (const s of index.symbols) {
      expect(s.variableValue).toBe(false);
      expect(s.approximate).toEqual(["palette", "build"]);
    }
  });
});

describe("opensymbols generate: exit codes and the output directory", () => {
  it("one skipped symbol in 101 (not more than 1%) exits 0; a DecodeError skips only its symbol", () => {
    const facets: Array<[string, (id: number) => ReturnType<typeof plain>]> = [];
    for (let i = 0; i < 100; i++) facets.push([`s${String(i).padStart(3, "0")}.fill`, plain]);
    facets.push([
      "corrupt",
      (id) => [
        ...plain(id).filter((x) => x.key[26] !== 4),
        { key: { 17: id, 26: 4 }, payload: new TextEncoder().encode("not a BVG document") },
      ],
    ]);
    const root = writeCatalog(join(tmp, "hundred"), { facets });
    const OUT = newOut();
    const r = exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular", "--name", "my-icons"]);
    expect(r.err).toContain("generated 100 symbols");
    expect(r.err).toMatch(/corrupt: .+/);
    expect(r.code).toBe(0);
    const index = json(join(OUT, "index.json"));
    expect(index.symbols).toHaveLength(100);
    expect(index.symbols[0].component).toBe("S000Fill");
    expect(index.symbols[99].chunk).toBe(0);
    expect(json(join(OUT, "package.json")).name).toBe("my-icons");
    expect(Object.keys(json(join(OUT, "chunks", "0.json"))[0].variants.a0d0.masters)).toEqual(["4"]);
  });

  it("--masters regular: a non-regular weight is weight-unavailable", async () => {
    const root = writeCatalog(join(tmp, "regular-only"), { facets: [["one", plain]] });
    const OUT = newOut();
    expect(exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    const One = (await import(pathToFileURL(join(OUT, "symbols", "One.js")).href)).default;
    const html = renderToStaticMarkup(createElement(One, { weight: "black" }));
    expect(html).toContain('data-approximations="weight-unavailable build"');
  });

  it("a symbol without glyph metrics is generated, with a warning, and renders text layout flagged", async () => {
    const root = writeCatalog(join(tmp, "no-metrics"), {
      facets: [["bare", (id) => allMastersWithoutMetrics(id, () => [{ d: P_MLZ }])]],
    });
    const OUT = newOut();
    const r = exec(["generate", "--catalog", root, "--out", OUT]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("generated 1 symbol ");
    expect(r.err).toMatch(/warning: .*no glyph metrics/);
    const Bare = (await import(pathToFileURL(join(OUT, "symbols", "Bare.js")).href)).default;
    const html = renderToStaticMarkup(createElement(Bare, { layout: "text" }));
    expect(html).toContain('data-approximations="text-layout metrics build"');
  });

  it("a CARHEADER that fails its check: generated, unvalidated, with the note as a warning", () => {
    const root = writeCatalog(join(tmp, "badheader"), {
      facets: [["plain", plain]],
      header: { coreuiVersion: 1010, mainVersionString: "PROJECT:CoreUI-999" },
    });
    const OUT = newOut();
    const r = exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular"]);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/warning: .*CoreUI-999/);
    expect(r.err).toMatch(/not validated/);
    expect(json(join(OUT, "index.json")).build).toEqual({
      coreuiVersion: null,
      renditionCount: null,
      facetCount: 1,
      validated: false,
    });
    const gate = exec(["gate", "--catalog", root]);
    expect(gate.out).toMatch(/^documents=3 /);
    expect(gate.err).toMatch(/note: .*CoreUI-999/);
    const dump = exec(["dump", "plain", "--catalog", root]);
    expect(dump.code).toBe(0);
    expect(dump.out).not.toBe("");
    expect(dump.err).toMatch(/note: .*CoreUI-999/);
  });

  it("an unexpected error (not an encode or decode error) is rethrown naming the symbol", () => {
    const root = writeCatalog(join(tmp, "unexpected"), { facets: [["fine", plain], ["boom", plain]] });
    const catalog = openCatalogDir(root);
    const drawing = catalog.drawing.bind(catalog);
    catalog.drawing = (name, master, opts) => {
      if (name === "boom") throw new TypeError("kaput");
      return drawing(name, master, opts);
    };
    const e = (() => {
      try {
        generate(catalog, { out: newOut(), packageName: "x", masters: "regular" }, { err: () => {} });
      } catch (err) {
        return err as Error;
      }
      throw new Error("expected a throw");
    })();
    expect(e.message).toContain('"boom"');
    expect(e.message).toContain("kaput");
    expect(e.cause).toBeInstanceOf(TypeError);
  });

  it("chunks hold 200 symbols each", () => {
    const facets: Array<[string, typeof plain]> = [];
    for (let i = 0; i < 201; i++) facets.push([`c${i}`, plain]);
    const OUT = newOut();
    const r = exec(["generate", "--catalog", writeCatalog(join(tmp, "chunks"), { facets }), "--out", OUT, "--masters", "regular"]);
    expect(r.code).toBe(0);
    expect(readdirSync(join(OUT, "chunks")).sort()).toEqual(["0.json", "1.json"]);
    expect(json(join(OUT, "chunks", "0.json"))).toHaveLength(200);
    expect(json(join(OUT, "chunks", "1.json"))).toHaveLength(1);
    expect(json(join(OUT, "index.json")).symbols[200].chunk).toBe(1);
  });

  it("needs --out (exit 2) and a catalog (exit 2)", () => {
    expect(exec(["generate", "--catalog", threeSymbols]).code).toBe(2);
    const r = exec(["generate", "--out", newOut()]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("SF_CATALOG_DIR");
  });

  it("rejects a flag that does not apply to generate (exit 2), naming it", () => {
    const r = exec(["generate", "--catalog", threeSymbols, "--out", newOut(), "--master", "4"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--master");
  });

  it("reruns over the remains of a run that stopped before writing index.json", () => {
    const OUT = newOut();
    const root = writeCatalog(join(tmp, "rerun"), { facets: [["kept", plain]] });
    mkdirSync(join(OUT, ".opensymbols-staging", "symbols"), { recursive: true });
    mkdirSync(join(OUT, "symbols"), { recursive: true });
    writeFileSync(join(OUT, "symbols", "Stale.js"), "");
    writeFileSync(join(OUT, "package.json"), "{}");
    expect(exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual(["Kept.d.ts", "Kept.js"]);
    expect(readdirSync(OUT)).not.toContain(".opensymbols-staging");
  });

  it("refuses a dir holding only generation-like names but no staging dir or symbols/ (a lone package.json)", () => {
    const OUT = newOut();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "package.json"), '{"name":"mine"}');
    expect(exec(["generate", "--catalog", threeSymbols, "--out", OUT]).code).toBe(2);
    expect(readFileSync(join(OUT, "package.json"), "utf8")).toBe('{"name":"mine"}');
  });

  it("refuses an index.json that a generation did not write (formatVersion alone is not enough)", () => {
    const OUT = newOut();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "index.json"), '{"formatVersion":1}');
    const r = exec(["generate", "--catalog", threeSymbols, "--out", OUT]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("index.json");
    expect(readdirSync(OUT)).toEqual(["index.json"]);
  });

  it("refuses a non-empty directory that is not a previous output (exit 2), touching nothing", () => {
    const OUT = newOut();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "notes.txt"), "mine");
    const r = exec(["generate", "--catalog", threeSymbols, "--out", OUT]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("index.json");
    expect(readdirSync(OUT)).toEqual(["notes.txt"]);
  });

  it("replaces a previous output: stale symbol modules and chunks are removed", () => {
    const OUT = newOut();
    const first = writeCatalog(join(tmp, "first"), { facets: [["gone", plain], ["kept", plain]] });
    expect(exec(["generate", "--catalog", first, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(existsSync(join(OUT, "symbols", "Gone.js"))).toBe(true);
    const second = writeCatalog(join(tmp, "second"), { facets: [["kept", plain]] });
    expect(exec(["generate", "--catalog", second, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual(["Kept.d.ts", "Kept.js"]);
    expect(json(join(OUT, "index.json")).symbols.map((s: { name: string }) => s.name)).toEqual(["kept"]);
    expect(readdirSync(OUT).sort()).toEqual(["chunks", "index.d.ts", "index.js", "index.json", "package.json", "symbols"]);
  });

  it("a component-name collision is fatal before anything is written (exit 1)", () => {
    const root = writeCatalog(join(tmp, "collide"), { facets: [["a.b", plain], ["a-b", plain]] });
    const OUT = newOut();
    const r = exec(["generate", "--catalog", root, "--out", OUT]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('component "AB"');
    expect(existsSync(OUT)).toBe(false);
  });

  it("a malformed app/ file is a usage error naming the file (exit 2)", () => {
    const root = writeCatalog(join(tmp, "badapp"), {
      facets: [["plain", plain]],
      app: { "layerset_availability.plist": "not a plist" },
    });
    const r = exec(["generate", "--catalog", root, "--out", newOut()]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("layerset_availability.plist");
  });

  it("uses the Apple palette when app/ has colors-26.csv", () => {
    const csv = 'macOS Color Name,Light Standard,Dark Standard\nsystemBlueColor,"0, 136, 255","0, 145, 255"\n';
    const root = writeCatalog(join(tmp, "apple"), { facets: [["plain", plain]], app: { "colors-26.csv": csv } });
    const OUT = newOut();
    expect(exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(json(join(OUT, "index.json")).palette).toBe("apple");
  });
});
