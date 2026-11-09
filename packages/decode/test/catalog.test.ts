import { describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.js";
import { DecodeError } from "../src/errors.js";
import { buildBvg } from "./helpers/build-bvg.js";
import { buildCar, type RenditionSpec } from "./helpers/build-car.js";
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
    expect(c.skipped).toEqual({ facets: 0, renditions: 0, nonVector: 1, idEntries: 0 });
    c.skipped.nonVector = 99;
    expect(c.skipped.nonVector).toBe(1);
    expect(catalog().skipped).toEqual({ facets: 0, renditions: 0, nonVector: 0, idEntries: 0 });
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
        facets: { a: 1, b: 2 },
        renditions: [
          rend(1, 4, "ltr", { 4: 4 }),
          rend(1, 4, "rtl", { 4: 5 }),
          rend(2, 4, "base", { 4: 0 }),
          rend(2, 4, "l", { 4: 4 }),
          rend(2, 4, "r", { 4: 5 }),
        ],
      }),
      bundleFiles,
    });
    expect(byName(pair, "a")?.variants.direction).toEqual([4, 5]);
    expect(byName(pair, "b")?.variants.direction).toEqual([0, 4, 5]);
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
});
