import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { decodeSymbol, type SymbolData } from "@opensymbols/core";
import { openCatalogDir } from "../../src/catalog-dir.js";
import { moduleJson } from "../../src/generate/module-source.js";
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
/** The format 2 data a generated module carries. */
const wireOf = (out: string, component: string) =>
  JSON.parse(moduleJson(readFileSync(join(out, "symbols", `${component}.js`), "utf8")) as string);
/** The same, expanded. */
const dataOf = (out: string, component: string): SymbolData => decodeSymbol(wireOf(out, component));

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
    expect(r.err).toContain('    bad.masters: variant a0d0: layer 0 step 2: "L", master 4 has "Z"\n');
    expect(existsSync(join(OUT, "index.json"))).toBe(true);
  });

  it("writes index.json: symbols, the build fingerprint, the palette and the localized facets", () => {
    const index = json(join(OUT, "index.json"));
    expect(index.formatVersion).toBe(2);
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
    expect(index.localized).toEqual([{ name: "plain.circle.rtl", base: "plain.circle", became: ["rtl"] }]);
  });

  it("warns on stderr that the build is not validated", () => {
    expect(r.err).toMatch(/warning: .*not .*validated/i);
  });

  it("writes a format 2 module per symbol, one shared declaration, and the index re-exports them and the aliases", () => {
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual(["PlainCircle.js", "SpeakerKnockout.js"]);
    const mod = readFileSync(join(OUT, "symbols", "PlainCircle.js"), "utf8");
    expect(mod).toMatch(
      /^"use client";\nimport \{ createIcon \} from "@opensymbols\/react";\nexport default \/\*#__PURE__\*\/createIcon\(\{"v":2,/,
    );
    expect(mod.endsWith("});\n")).toBe(true);
    expect(wireOf(OUT, "PlainCircle").variants.a0d0).not.toHaveProperty("argCounts");
    expect(readFileSync(join(OUT, "index.js"), "utf8")).not.toContain("use client");
    expect(readFileSync(join(OUT, "symbol.d.ts"), "utf8")).toBe(
      'declare const C: import("@opensymbols/react").OpenSymbolIcon;\nexport default C;\n',
    );
    const lines = [
      'export { default as PlainCircle } from "./symbols/PlainCircle.js";',
      'export { default as SpeakerKnockout } from "./symbols/SpeakerKnockout.js";',
      'export { default as OldPlain } from "./symbols/PlainCircle.js";',
    ];
    expect(readFileSync(join(OUT, "index.js"), "utf8")).toBe(lines.join("\n") + "\n");
    expect(readFileSync(join(OUT, "index.d.ts"), "utf8")).toBe(
      [
        'type Icon = import("@opensymbols/react").OpenSymbolIcon;',
        "export declare const PlainCircle: Icon;",
        "export declare const SpeakerKnockout: Icon;",
        "export declare const OldPlain: Icon;",
      ].join("\n") + "\n",
    );
  });

  it("writes the .rtl facet as the base symbol's Direction 5 variant, since the base has none", () => {
    const data = dataOf(OUT, "PlainCircle");
    expect(Object.keys(data.variants)).toEqual(["a0d0", "a0d5"]);
    expect(data.defaultVariant).toBe("a0d0");
    expect(data.locales).toBeUndefined();
  });

  it("writes no chunks, and an installable package.json", () => {
    expect(existsSync(join(OUT, "chunks"))).toBe(false);
    expect(json(join(OUT, "package.json"))).toEqual({
      name: "opensymbols",
      version: "0.0.0",
      private: true,
      type: "module",
      sideEffects: false,
      main: "index.js",
      types: "index.d.ts",
      exports: {
        ".": { types: "./index.d.ts", default: "./index.js" },
        "./index.json": "./index.json",
        "./symbols/*": { types: "./symbol.d.ts", default: "./symbols/*" },
        "./*": { types: "./symbol.d.ts", default: "./symbols/*.js" },
      },
      peerDependencies: { "@opensymbols/react": "*", react: ">=19" },
    });
  });

  it("deep imports resolve through the exports map", () => {
    // Self-reference: inside the package, its own name resolves through its exports.
    const script = [
      'for (const s of ["opensymbols", "opensymbols/PlainCircle", "opensymbols/index.json", "opensymbols/symbols/PlainCircle.js"])',
      "  console.log(import.meta.resolve(s));",
    ].join("\n");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: OUT, encoding: "utf8" });
    const [root, deep, index, file] = out.trim().split(/\r?\n/);
    expect(root).toBe(pathToFileURL(join(OUT, "index.js")).href);
    expect(deep).toBe(pathToFileURL(join(OUT, "symbols", "PlainCircle.js")).href);
    expect(index).toBe(pathToFileURL(join(OUT, "index.json")).href);
    expect(file).toBe(pathToFileURL(join(OUT, "symbols", "PlainCircle.js")).href);
  });

  it("every symbol carries the build's validation, and an unvalidated build renders flagged", async () => {
    for (const c of ["PlainCircle", "SpeakerKnockout"]) expect(wireOf(OUT, c).build).toEqual({ validated: false });
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
    expect(Object.keys(wireOf(OUT, "S000Fill").variants.a0d0.masters)).toEqual(["4"]);
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

  it("index.json puts 200 symbols in each demo chunk", () => {
    const facets: Array<[string, typeof plain]> = [];
    for (let i = 0; i < 201; i++) facets.push([`c${i}`, plain]);
    const OUT = newOut();
    const r = exec(["generate", "--catalog", writeCatalog(join(tmp, "chunks"), { facets }), "--out", OUT, "--masters", "regular"]);
    expect(r.code).toBe(0);
    const chunks = json(join(OUT, "index.json")).symbols.map((s: { chunk: number }) => s.chunk);
    expect(chunks.filter((c: number) => c === 0)).toHaveLength(200);
    expect(chunks[200]).toBe(1);
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
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual(["Kept.js"]);
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

  it("replaces a previous output: stale symbol modules, declarations and an earlier format's chunks are removed", () => {
    const OUT = newOut();
    const first = writeCatalog(join(tmp, "first"), { facets: [["gone", plain], ["kept", plain]] });
    expect(exec(["generate", "--catalog", first, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(existsSync(join(OUT, "symbols", "Gone.js"))).toBe(true);
    // What a format 1 generation also wrote.
    mkdirSync(join(OUT, "chunks"));
    writeFileSync(join(OUT, "chunks", "0.json"), "[]");
    writeFileSync(join(OUT, "symbols", "Gone.d.ts"), "");
    const second = writeCatalog(join(tmp, "second"), { facets: [["kept", plain]] });
    expect(exec(["generate", "--catalog", second, "--out", OUT, "--masters", "regular"]).code).toBe(0);
    expect(readdirSync(join(OUT, "symbols")).sort()).toEqual(["Kept.js"]);
    expect(json(join(OUT, "index.json")).symbols.map((s: { name: string }) => s.name)).toEqual(["kept"]);
    expect(readdirSync(OUT).sort()).toEqual(["index.d.ts", "index.js", "index.json", "package.json", "symbol.d.ts", "symbols"]);
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

describe("opensymbols generate: localized drawings (Docs/format/05 section 4.3)", () => {
  const LOC = { ar: 1, hi: 2, "zh-Hans": 3, "zh-Hant": 4 };
  const at = (rs: ReturnType<typeof plain>, key: Record<number, number>) => rs.map((r) => ({ ...r, key: { ...r.key, ...key } }));
  const root = writeCatalog(join(tmp, "localized"), {
    facets: [
      [
        "globe",
        (id) => [
          // Left to right and right to left of its own, and a token-13 Arabic drawing.
          ...at(allMasters(id, () => [{ d: P_MLZ }]), { 4: 4 }),
          ...at(allMasters(id, () => [{ d: P_MLZ }]), { 4: 5 }),
          ...at(allMasters(id, () => [{ d: P_MZ }]), { 13: LOC.ar }),
        ],
      ],
      ["globe.ar", (id) => allMasters(id, () => [{ d: P_MLLZ }])],
      ["globe.hi", (id) => allMasters(id, () => [{ d: P_MLLZ }])],
      ["globe.zh", (id) => allMasters(id, () => [{ d: P_MZ }])],
      ["globe.rtl", plain],
      // Its Hindi drawing is not point-compatible: the symbol is skipped, like any variant.
      ["flag", (id) => [...plain(id), ...at(incompatible(id), { 13: LOC.hi })]],
    ],
    localizations: LOC,
  });
  const OUT = newOut();
  const r = exec(["generate", "--catalog", root, "--out", OUT]);
  const index = json(join(OUT, "index.json"));

  it("writes each localized drawing into the base symbol's locales, token 13 before the facet", () => {
    const data = dataOf(OUT, "Globe");
    expect(Object.keys(data.locales ?? {})).toEqual(["ar", "hi", "zh-Hans", "zh-Hant"]);
    expect(data.locales!.ar!.a0d0!.ops).toBe("MZ"); // the token-13 rendition, not globe.ar
    expect(data.locales!.hi!.a0d0!.ops).toBe("MLLZ"); // the facet
    expect(data.locales!["zh-Hans"]).toEqual(data.locales!["zh-Hant"]);
    expect(Object.keys(data.locales!["zh-Hans"]!.a0d0!.masters)).toEqual(["1", "4", "9"]);
    // Its own Direction 5: the .rtl facet adds nothing.
    expect(Object.keys(data.variants)).toEqual(["a0d4", "a0d5"]);
  });

  it("lists every localized facet with what it became, and generates none of them standalone", () => {
    expect(index.symbols.map((s: { name: string }) => s.name)).toEqual(["globe"]);
    expect(index.localized).toEqual([
      { name: "globe.ar", base: "globe", became: [] },
      { name: "globe.hi", base: "globe", became: ["hi"] },
      { name: "globe.zh", base: "globe", became: ["zh-Hans", "zh-Hant"] },
      { name: "globe.rtl", base: "globe", became: [] },
    ]);
    expect(readdirSync(join(OUT, "symbols"))).toEqual(["Globe.js"]);
    expect(r.err).toContain("localized: 4 localized drawings across 1 symbol; 2 of 4 localized facets");
  });

  it("skips a symbol whose localized drawing is not point-compatible, naming the locale", () => {
    expect(r.code).toBe(1);
    expect(index.skipped).toEqual([{ name: "flag", reason: expect.stringContaining("a0d0 (hi): master 9") }]);
    expect(r.err).toContain("    flag: variant a0d0 (hi): layer 0 step 2");
  });
});

describe("opensymbols generate: the shared declaration type-checks through the exports map", () => {
  const OUT = newOut();
  const root = writeCatalog(join(tmp, "types"), {
    facets: [["plain.circle", plain]],
    aliases: { "old.plain": "plain.circle" },
  });
  const tsc = resolve(import.meta.dirname, "..", "..", "..", "..", "node_modules", "typescript", "bin", "tsc");
  const consumer = [
    'import type { OpenSymbolIcon } from "@opensymbols/react";',
    'import { PlainCircle, OldPlain } from "opensymbols";',
    'import Deep from "opensymbols/PlainCircle";',
    'import File from "opensymbols/symbols/PlainCircle.js";',
    "export const all: OpenSymbolIcon[] = [PlainCircle, OldPlain, Deep, File];",
    // Typed, not `any`: each of these is an error, which @ts-expect-error requires.
    "// @ts-expect-error",
    "export const n1: number = PlainCircle;",
    "// @ts-expect-error",
    "export const n2: number = Deep;",
    "// @ts-expect-error",
    "export const n3: number = File;",
    "",
  ].join("\n");

  for (const [module, resolution] of [
    ["esnext", "bundler"],
    ["nodenext", "nodenext"],
  ] as const) {
    it(`moduleResolution ${resolution}`, { timeout: 60_000 }, () => {
      if (!existsSync(join(OUT, "index.json"))) {
        expect(exec(["generate", "--catalog", root, "--out", OUT, "--masters", "regular"]).code).toBe(0);
      }
      // A consumer beside the package (so @opensymbols/react and react's types resolve as they
      // would in an app), with the package linked into its node_modules.
      const dir = `${OUT}-consumer-${resolution}`;
      outs.push(dir);
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      symlinkSync(OUT, join(dir, "node_modules", "opensymbols"), "junction");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(dir, "index.ts"), consumer);
      const compilerOptions = { strict: true, noEmit: true, module, moduleResolution: resolution, target: "es2022", types: [] };
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["index.ts"] }));
      let output = "";
      try {
        execFileSync(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], { encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        output = String((e as { stdout?: string }).stdout || e);
      }
      expect(output).toBe("");
    });
  }
});
