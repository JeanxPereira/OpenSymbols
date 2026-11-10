import { describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.js";
import { DecodeError } from "../src/errors.js";
import { buildBvg } from "./helpers/build-bvg.js";
import { buildCar, f32s, le, tlvSection, type RenditionSpec } from "./helpers/build-car.js";
import { buildBplist } from "./helpers/build-plist.js";
import { buildStyle } from "./helpers/build-style.js";

// Key format of the synthetic catalog: Direction, Appearance, Localization, Identifier, GlyphWeight.
const KEY_FORMAT = [4, 7, 13, 17, 26];

/** A BVG document whose only local string is `label`, to tell renditions apart. */
const doc = (label: string): Uint8Array =>
  buildBvg({ typeCode: 0x11, localStrings: [label], root: { tag: 0 } });

const rend = (
  id: number,
  weight: number,
  label: string,
  extra: Record<number, number> = {},
): RenditionSpec => ({ key: { 17: id, 26: weight, ...extra }, payload: doc(label) });

const label = (c: Catalog, name: string, master: 1 | 4 | 9, opts?: object) =>
  c.document(name, master, opts).strings[0];

const files = (entries: Record<string, Uint8Array>) => new Map(Object.entries(entries));

const bundleFiles = files({
  "name_availability.plist": buildBplist({
    symbols: { wifi: "2019", airplane: "2019", "0.circle": "2019", "0.circle.ar": "2019" },
    year_to_release: { "2019": { iOS: "13.0" } },
  }),
  "name_aliases.strings": buildBplist({ "wifi.old": "wifi", "wifi.older": "wifi" }),
  "symbol_categories.plist": buildBplist({ wifi: ["connectivity"] }),
  "symbol_search.plist": buildBplist({ wifi: ["network"] }),
});

const car = buildCar({
  keyFormat: KEY_FORMAT,
  facets: { wifi: 1, airplane: 2, "0.circle": 3, "0.circle.ar": 4, "x.rtl": 6 },
  localizations: { ar: 59797 },
  appearances: { dark: 1 },
  renditions: [
    // wifi: appearance 0 and 1, direction 0
    ...[1, 4, 9].map((m) => rend(1, m, `wifi-${m}-a0`, { 7: 0 })),
    ...[1, 4, 9].map((m) => rend(1, m, `wifi-${m}-a1`, { 7: 1 })),
    // airplane: Direction {5} only
    ...[1, 4, 9].map((m) => rend(2, m, `air-${m}`, { 4: 5 })),
    // 0.circle: plain; 0.circle.ar: its own facet
    rend(3, 4, "c0"),
    rend(4, 4, "c0ar"),
    // a rendition whose identifier no facet names
    rend(77, 4, "nofacet"),
    // x.rtl: stem "x" is not a symbol
    rend(6, 4, "xrtl"),
  ],
});

const catalog = () => Catalog.open({ car, bundleFiles });
const byName = (c: Catalog, n: string) => c.symbols().find((s) => s.name === n);

describe("Catalog (Docs/format/01 section 5.3, 05 section 4)", () => {
  it("exposes a copy of the skipped-record counters", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1 },
        renditions: [{ key: { 17: 1 }, rawPayload: new TextEncoder().encode("%PDF-1.7") }],
      }),
      bundleFiles,
    });
    expect(c.skipped).toEqual({ facets: 0, renditions: 0, nonVector: 1, idEntries: 0, metrics: 0, raster: 0 });
    c.skipped.nonVector = 99;
    expect(c.skipped.nonVector).toBe(1);
    expect(catalog().skipped).toEqual({ facets: 0, renditions: 0, nonVector: 0, idEntries: 0, metrics: 0, raster: 0 });
  });

  it("marks a facet drawable only when it has a vector rendition (01 §3.10)", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1, pixels: 2 },
        renditions: [
          rend(1, 4, "a", {}),
          // _gradient.highlegibility on 26A5416b: two MLEC renditions, no vector.
          { key: { 17: 2 }, layout: 12, rawPayload: new TextEncoder().encode("MLEC\0\0\0\0") },
        ],
      }),
      bundleFiles,
    });
    expect(byName(c, "a")?.drawable).toBe(true);
    expect(byName(c, "pixels")?.drawable).toBe(false);
    expect(c.symbols()).toHaveLength(2);
  });

  it("exposes a copy of the skip records with their reasons", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1 },
        renditions: [{ key: { 17: 1 }, rawPayload: new TextEncoder().encode("%PDF-1.7") }],
      }),
      bundleFiles,
    });
    expect(c.skipRecords).toEqual([
      { tree: "RENDITIONS", index: 0, reason: expect.stringMatching(/not DWAR/) },
    ]);
    c.skipRecords[0]!.reason = "changed";
    expect(c.skipRecords[0]!.reason).toMatch(/not DWAR/);
    expect(catalog().skipRecords).toEqual([]);
  });

  it("exposes the KEYFORMAT token order", () => {
    expect(catalog().keyFormat).toEqual(KEY_FORMAT);
  });

  it("picks the lowest (Direction, Appearance) rendition by default", () => {
    const c = catalog();
    expect(label(c, "wifi", 4)).toBe("wifi-4-a0");
    expect(label(c, "wifi", 1)).toBe("wifi-1-a0");
    expect(label(c, "wifi", 9)).toBe("wifi-9-a0");
  });

  it("filters on an explicit appearance", () => {
    expect(label(catalog(), "wifi", 4, { appearance: 1 })).toBe("wifi-4-a1");
  });

  it("resolves a {5}-only facet without options and reports no direction variant", () => {
    const c = catalog();
    expect(label(c, "airplane", 4)).toBe("air-4");
    expect(byName(c, "airplane")?.variants).toEqual({ appearance: [], direction: [] });
  });

  it("reports sorted appearance and direction sets when they vary", () => {
    expect(byName(catalog(), "wifi")?.variants).toEqual({ appearance: [0, 1], direction: [] });
    const pair = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1, b: 2, c: 3 },
        renditions: [
          rend(1, 4, "ltr", { 4: 4 }),
          rend(1, 4, "rtl", { 4: 5 }),
          rend(2, 4, "base", { 4: 0 }),
          rend(2, 4, "l", { 4: 4 }),
          rend(2, 4, "r", { 4: 5 }),
          // list.number on 26A5416b: direction 0 is stored only for a localization (ar).
          rend(3, 4, "l", { 4: 4 }),
          rend(3, 4, "r", { 4: 5 }),
          rend(3, 4, "ar", { 4: 0, 13: 59797 }),
        ],
      }),
      bundleFiles,
    });
    expect(byName(pair, "a")?.variants.direction).toEqual([4, 5]);
    expect(byName(pair, "b")?.variants.direction).toEqual([0, 4, 5]);
    // Variants are what the pick can reach: localization 0 only (05 §4.4).
    expect(byName(pair, "c")?.variants.direction).toEqual([4, 5]);
    expect(label(pair, "a", 4)).toBe("ltr");
    expect(label(pair, "a", 4, { direction: 5 })).toBe("rtl");
    expect(label(pair, "b", 4)).toBe("base");
  });

  it("throws a DecodeError naming the symbol and key for a missing combination", () => {
    const c = catalog();
    expect(() => c.document("wifi", 4, { appearance: 7 })).toThrow(DecodeError);
    expect(() => c.document("wifi", 4, { appearance: 7 })).toThrow(/wifi.*appearance 7/);
    expect(() => c.document("nope", 4)).toThrow(/nope/);
    expect(() => c.document("0.circle", 1)).toThrow(/0\.circle.*weight 1/);
  });

  it("throws a DecodeError naming the symbol and tuple when two renditions tie (05 section 4.4)", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { tie: 1 },
        renditions: [rend(1, 4, "first", { 7: 1 }), rend(1, 4, "second", { 7: 1 })],
      }),
      bundleFiles,
    });
    expect(() => c.document("tie", 4)).toThrow(DecodeError);
    expect(() => c.document("tie", 4)).toThrow(
      /"tie".*identifier 1, weight 4, localization 0, direction 0, appearance 1/,
    );
  });

  it("hasRendition answers the pick without throwing when nothing matches", () => {
    const c = catalog();
    expect(c.hasRendition("wifi", 4)).toBe(true);
    expect(c.hasRendition("wifi", 4, { appearance: 1 })).toBe(true);
    expect(c.hasRendition("wifi", 4, { appearance: 2 })).toBe(false);
    expect(c.hasRendition("wifi.old", 9)).toBe(true);
    expect(c.hasRendition("airplane", 4, { direction: 5 })).toBe(true);
    expect(c.hasRendition("airplane", 4, { direction: 4 })).toBe(false);
    expect(c.hasRendition("0.circle", 1)).toBe(false);
    expect(c.hasRendition("missing", 4)).toBe(false);
  });

  it("hasRendition still throws on a tie, as document does", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { tie: 1 },
        renditions: [rend(1, 4, "first", { 7: 1 }), rend(1, 4, "second", { 7: 1 })],
      }),
      bundleFiles,
    });
    expect(() => c.hasRendition("tie", 4)).toThrow(DecodeError);
  });

  it("follows aliases in resolve and lists them on the modern entry", () => {
    const c = catalog();
    expect(c.resolve("wifi.old")?.name).toBe("wifi");
    expect(c.resolve("wifi")?.aliases).toEqual(["wifi.old", "wifi.older"]);
    expect(c.resolve("missing")).toBeUndefined();
    expect(label(c, "wifi.old", 4)).toBe("wifi-4-a0");
  });

  it("joins metadata onto entries", () => {
    expect(byName(catalog(), "wifi")).toMatchObject({
      identifier: 1,
      year: "2019",
      categories: ["connectivity"],
      searchTerms: ["network"],
    });
    expect(byName(catalog(), "0.circle")?.categories).toEqual([]);
  });

  it("marks a localized variant by name suffix, only when the stem is a symbol", () => {
    const c = catalog();
    expect(byName(c, "0.circle.ar")?.localizedVariantOf).toBe("0.circle");
    expect(byName(c, "0.circle")?.localizedVariantOf).toBeUndefined();
    expect(byName(c, "x.rtl")?.localizedVariantOf).toBeUndefined();
  });

  it("matches a two-letter suffix to a script-qualified tag and rtl (04 section 4.3)", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1, "a.zh": 2, "a.rtl": 3 },
        localizations: { "zh-Hans": 5 },
        renditions: [rend(1, 4, "a"), rend(2, 4, "azh"), rend(3, 4, "artl")],
      }),
      bundleFiles,
    });
    expect(byName(c, "a.zh")?.localizedVariantOf).toBe("a");
    expect(byName(c, "a.rtl")?.localizedVariantOf).toBe("a");
  });

  it("picks a token-13 rendition by localization and lists each symbol's localizations (05 section 4.3)", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1, b: 2 },
        localizations: { ar: 59797, hi: 42419, "zh-Hans": 5 },
        renditions: [
          rend(1, 4, "a"),
          rend(1, 4, "a-ar", { 13: 59797 }),
          rend(1, 4, "a-hi-l", { 13: 42419, 4: 4 }),
          rend(1, 4, "a-hi-r", { 13: 42419, 4: 5 }),
          rend(2, 4, "b"),
        ],
      }),
      bundleFiles,
    });
    expect(c.localizations()).toEqual(new Map([["ar", 59797], ["hi", 42419], ["zh-Hans", 5]]));
    expect(label(c, "a", 4)).toBe("a");
    expect(label(c, "a", 4, { localization: 59797 })).toBe("a-ar");
    expect(label(c, "a", 4, { localization: 42419, direction: 5 })).toBe("a-hi-r");
    expect(c.hasRendition("a", 4, { localization: 5 })).toBe(false);
    expect(() => c.document("a", 4, { localization: 5 })).toThrow(/localization 5/);
    // The same §4.4 axes rule as `variants`, per localization; the base (0) is not listed.
    expect(c.localizationsOf("a")).toEqual(
      new Map([
        [59797, { appearance: [], direction: [] }],
        [42419, { appearance: [], direction: [4, 5] }],
      ]),
    );
    expect(c.localizationsOf("b")).toEqual(new Map());
    expect(c.localizationsOf("nope")).toEqual(new Map());
  });

  it("documents() enumerates every vector rendition, including ones no facet reaches", () => {
    const all = [...catalog().documents()];
    expect(all).toHaveLength(6 + 3 + 1 + 1 + 1 + 1);
    const orphan = all.find((d) => d.key[17] === 77);
    expect(orphan?.name).toBe("");
    expect(String.fromCharCode(...(orphan?.bytes.subarray(0, 4) ?? []))).toBe("BVG ");
    expect(all.find((d) => d.key[17] === 1)?.name).toBe("wifi");
  });

  it("drawing() builds from the picked document (06 section 2)", () => {
    // Atoms (02 section 3): g 1, viewBox 2, transform 21, defaults 52, valueMode 39, color 49, drawReverses 38, false 54.
    const g = { tag: 1, attrs: [{ name: 21, value: 90 }] };
    const style = buildStyle({
      indexWidth: 1,
      offsetWidth: 1,
      classes: [{ kind: 0x00, layer: 0, value: 52, rule: 0 }],
      rules: [[{ property: 39, values: [49] }, { property: 38, values: [54] }]],
    });
    const drawable = buildBvg({
      typeCode: 0x11,
      localStrings: [new Uint8Array([0x00, 0x41, 0x10, 0x20, 0x03, 0x50]), "matrix(1 0 0 1 0 0)"],
      idPairs: [{ stringIndex: 63, target: g }],
      root: { tag: 0, attrs: [{ name: 2, value: 89 }], children: [g] },
      style,
    });
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1 },
        renditions: [{ key: { 17: 1, 26: 4 }, payload: drawable }],
      }),
      bundleFiles,
    });
    expect(c.drawing("a", 4).viewBox).toEqual([0, 0, 3, 5]);
    expect(c.drawing("a", 4).layers).toEqual([]);
  });

  it("returns the glyph metrics of the picked rendition and the catalog header", () => {
    const m = tlvSection([1018, new Uint8Array([...le(4, 7, 17), ...f32s(-1.5, 9.25, 6, 0.5, 0.888672, 0.75, 0.888672)])]);
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1, b: 2 },
        header: { coreuiVersion: 1010, renditionCount: 2 },
        renditions: [
          { key: { 17: 1, 26: 4 }, payload: doc("a"), tlv: m },
          { key: { 17: 2, 26: 4 }, payload: doc("b") },
        ],
      }),
      bundleFiles,
    });
    expect(c.metrics("a", 4)).toEqual({
      referencePointSize: 17,
      baselineOffset: -1.5,
      capHeight: 9.25,
      leftInset: 0.5,
      rightInset: 0.75,
    });
    expect(() => c.metrics("b", 4)).toThrow(DecodeError);
    expect(c.header).toEqual({ coreuiVersion: 1010, renditionCount: 2 });
  });

  it("opens a catalog whose CARHEADER does not check out: no header, a note, its symbols still read", () => {
    const c = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { a: 1 },
        header: { coreuiVersion: 1010, mainVersionString: "PROJECT:CoreUI-999" },
        renditions: [{ key: { 17: 1, 26: 4 }, payload: doc("a") }],
      }),
      bundleFiles,
    });
    expect(c.header).toBeUndefined();
    expect(c.headerNote).toContain("CoreUI-999");
    expect(c.symbols().map((e) => e.name)).toEqual(["a"]);
    expect(c.document("a", 4)).toBeDefined();
  });

  it("exposes a copy of the APPEARANCEKEYS name → id map", () => {
    const c = catalog();
    expect(c.appearances()).toEqual(new Map([["dark", 1]]));
    c.appearances().set("x", 9);
    expect(c.appearances().has("x")).toBe(false);
  });

  it("parses appFiles into read-only app metadata, undefined without them", () => {
    expect(catalog().appMetadata).toBeUndefined();
    const c = Catalog.open({
      car,
      bundleFiles,
      appFiles: files({
        "layerset_availability.plist": buildBplist({
          symbols: { wifi: { multicolor: "2019" } },
          year_to_release: {},
        }),
        "colors-26.csv": new TextEncoder().encode(
          'macOS Color Name,Light Standard,Dark Standard\nsystemBlueColor,"0, 136, 255","0, 145, 255"\n',
        ),
      }),
    });
    expect(c.appMetadata?.layersetAvailability.get("wifi")).toEqual(["monochrome", "multicolor", "palette"]);
    expect(c.appMetadata?.palette?.light.get("systemBlueColor")).toBe("#0088ff");
    expect(c.appMetadata?.palette?.dark.get("systemBlueColor")).toBe("#0091ff");
  });

  it("a malformed app file does not fail Catalog.open; it throws on appMetadata access", () => {
    const c = Catalog.open({ car, bundleFiles, appFiles: files({ "base_symbols_map.json": new TextEncoder().encode("{") }) });
    expect(c.symbols().length).toBeGreaterThan(0);
    expect(() => c.appMetadata).toThrow(DecodeError);
    expect(() => c.appMetadata).toThrow(DecodeError);
  });

  it("parses the app files once and returns the same object afterwards", () => {
    const c = Catalog.open({ car, bundleFiles, appFiles: files({}) });
    expect(c.appMetadata).toBe(c.appMetadata);
  });
});
