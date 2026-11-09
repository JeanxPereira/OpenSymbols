import { describe, expect, it } from "vitest";
import { AssetCatalog, Token } from "../src/car.js";
import { DecodeError } from "../src/errors.js";
import { ascii } from "./helpers/build-bom.js";
import { bvg, buildCar, f32s, le, tlvSection, type RenditionSpec } from "./helpers/build-car.js";
import { concat } from "./helpers/build-bom.js";

const wifi = (weight: number, extra: Partial<RenditionSpec> = {}): RenditionSpec => ({
  key: { 7: 0, 17: 42, 26: weight },
  payload: bvg(`w${weight}`),
  ...extra,
});

const text = (b: Uint8Array) => String.fromCharCode(...b);

describe("AssetCatalog", () => {
  const base = {
    facets: { wifi: 42, "wifi.slash": 43 },
    renditions: [
      wifi(1),
      wifi(4),
      wifi(9),
      { key: { 7: 0, 17: 43, 26: 4 }, payload: bvg("slash") },
    ],
  };

  it("exports the token constants", () => {
    expect(Token).toEqual({
      Direction: 4,
      Appearance: 7,
      Dimension2: 9,
      Scale: 12,
      Localization: 13,
      Identifier: 17,
      GlyphWeight: 26,
      GlyphSize: 27,
    });
  });

  it("maps a facet name to its identifier and reads the key format", () => {
    const cat = AssetCatalog.open(buildCar(base));
    expect(cat.facets().get("wifi")).toBe(42);
    expect(cat.facets().size).toBe(2);
    expect(cat.keyFormat).toEqual([7, 17, 26]);
  });

  it("returns the three weights of an identifier with BVG payloads", () => {
    const cat = AssetCatalog.open(buildCar(base));
    const r = cat.renditions(42);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.key[26]).sort()).toEqual([1, 4, 9]);
    for (const x of r) {
      expect(x.layout).toBe(1022);
      expect(text(x.payload!.subarray(0, 4))).toBe("BVG ");
    }
    expect(cat.renditions(999)).toEqual([]);
  });

  it("gives a layout 1003 rendition a null payload", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { wifi: 42 },
        renditions: [wifi(1), { key: { 17: 42, 26: 1 }, layout: 1003, payload: null }],
      }),
    );
    const r = cat.renditions(42);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.layout === 1003)!.payload).toBeNull();
    expect(r.find((x) => x.layout === 1022)!.payload).not.toBeNull();
  });

  it("maps tokens by position for a key format of a different length", () => {
    const cat = AssetCatalog.open(
      buildCar({
        keyFormat: [7, 13, 1, 2, 4, 17, 8, 9, 10, 14, 12, 19, 18, 25, 26, 27],
        facets: { wifi: 5 },
        renditions: [{ key: { 17: 5, 26: 9, 27: 1, 13: 3 }, payload: bvg() }],
      }),
    );
    expect(cat.keyFormat).toHaveLength(16);
    const [r] = cat.renditions(5);
    expect(r!.key[17]).toBe(5);
    expect(r!.key[26]).toBe(9);
    expect(r!.key[27]).toBe(1);
    expect(r!.key[13]).toBe(3);
  });

  it("reads the csiheader name and keeps the rendition whatever the TLV filler holds", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { wifi: 42 },
        renditions: [wifi(1, { name: "wifi.glyph", tlv: new Uint8Array(20).fill(0x44) })],
      }),
    );
    const [r] = cat.renditions(42);
    expect(r!.name).toBe("wifi.glyph");
    expect(text(r!.payload!)).toBe("BVG w1");
    expect(r!.metrics).toBeUndefined();
    expect(cat.skipped.renditions).toBe(0);
    expect(cat.metricsNotes[0]!.reason).toMatch(/TLV entry/);
  });

  it("reads a well-formed non-metrics TLV without a note", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { wifi: 42 },
        renditions: [wifi(1, { tlv: tlvSection([5, new Uint8Array(12).fill(0x44)]) })],
      }),
    );
    expect(cat.skipped.metrics).toBe(0);
    expect(text(cat.renditions(42)[0]!.payload!)).toBe("BVG w1");
  });

  it("leaves a payload without the DWAR tag as null", () => {
    // renditionLength > 0 but not a DWAR wrapper: not a vector drawing (§3.10).
    const cat = AssetCatalog.open(
      buildCar({
        facets: { a: 1 },
        renditions: [{ key: { 17: 1 }, rawPayload: ascii("%PDF-1.7") }],
      }),
    );
    expect(cat.renditions(1)).toHaveLength(1);
    expect(cat.renditions(1)[0]!.payload).toBeNull();
    expect(cat.skipped.nonVector).toBe(1);
  });

  it("does not count a layout 1003 slot as non-vector", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { a: 1 },
        renditions: [{ key: { 17: 1 }, layout: 1003, payload: null }, wifi(1, { key: { 17: 1 } })],
      }),
    );
    expect(cat.skipped).toEqual({ facets: 0, renditions: 0, nonVector: 0, idEntries: 0, metrics: 0 });
  });

  it("skips and counts facets without an identifier, and keeps the first of two", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { ok: 1, noid: 2, twice: 3 },
        facetAttributes: {
          noid: [[1, 85]],
          twice: [
            [17, 7],
            [17, 8],
          ],
        },
        renditions: [],
      }),
    );
    expect(cat.facets().get("ok")).toBe(1);
    expect(cat.facets().has("noid")).toBe(false);
    expect(cat.facets().get("twice")).toBe(7);
    expect(cat.skipped.facets).toBe(1);
  });

  it("records why each facet was skipped (Docs/format/01 section 3.4, section 6)", () => {
    const cat = AssetCatalog.open(
      buildCar({ facets: { noid: 2 }, facetAttributes: { noid: [[1, 85]] }, renditions: [] }),
    );
    expect(cat.skipRecords).toEqual([
      { tree: "FACETKEYS", index: 0, reason: expect.stringMatching(/noid.*no Identifier/) },
    ]);
  });

  it("skips and counts a facet whose attribute list is truncated", () => {
    // attributeCount says 3, only one (token, value) pair follows.
    const truncated = concat([le(4, 0), le(2, 3), le(2, 17, 5)]);
    const cat = AssetCatalog.open(
      buildCar({ facets: { ok: 1 }, rawFacets: [["trunc", truncated]], renditions: [] }),
    );
    expect(cat.facets().has("trunc")).toBe(false);
    expect(cat.facets().get("ok")).toBe(1);
    expect(cat.skipped.facets).toBe(1);
    expect(cat.skipRecords[0]).toMatchObject({ tree: "FACETKEYS", index: 1 });
    expect(cat.skipRecords[0]!.reason).toMatch(/trunc.*3 attributes/);
  });

  it("keeps the first of two facets with the same name and counts the second", () => {
    const dup = concat([le(4, 0), le(2, 1), le(2, 17, 9)]);
    const cat = AssetCatalog.open(
      buildCar({ facets: { dup: 1 }, rawFacets: [["dup", dup]], renditions: [] }),
    );
    expect(cat.facets().get("dup")).toBe(1);
    expect(cat.skipped.facets).toBe(1);
    expect(cat.skipRecords[0]!.reason).toMatch(/duplicate facet name "dup"/);
  });

  it("skips and counts an id-tree value shorter than two bytes", () => {
    const cat = AssetCatalog.open(
      buildCar({
        localizations: { ar: 59797 },
        rawLocalizations: [["xx", Uint8Array.of(1)]],
        renditions: [],
      }),
    );
    expect(cat.localizations().has("xx")).toBe(false);
    expect(cat.localizations().get("ar")).toBe(59797);
    expect(cat.skipped.idEntries).toBe(1);
    expect(cat.skipRecords).toEqual([
      { tree: "LOCALIZATIONKEYS", index: 1, reason: expect.stringMatching(/xx.*1 byte/) },
    ]);
  });

  it("keeps the first 20 skip records and counts them all", () => {
    const rawFacets = Array.from({ length: 25 }, (_, i): [string, Uint8Array] => [
      `bad${String(i).padStart(2, "0")}`,
      new Uint8Array(2),
    ]);
    const cat = AssetCatalog.open(buildCar({ rawFacets, renditions: [] }));
    expect(cat.skipped.facets).toBe(25);
    expect(cat.skipRecords).toHaveLength(20);
    expect(cat.skipRecords[0]!.index).toBe(0);
  });

  it("skips and counts a short rendition key and a short csiheader value", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { wifi: 42 },
        renditions: [
          wifi(1),
          wifi(4, { rawKey: new Uint8Array(4) }),
          wifi(9, { rawValue: new Uint8Array(100) }),
        ],
      }),
    );
    expect(cat.renditions(42)).toHaveLength(1);
    expect(cat.skipped.renditions).toBe(2);
  });

  it("rejects a csiheader tag other than ISTC, naming it", () => {
    const bytes = buildCar({
      facets: { wifi: 42 },
      renditions: [wifi(1, { tag: "CTSI" })],
    });
    expect(() => AssetCatalog.open(bytes)).toThrow(/CTSI/);
    expect(() => AssetCatalog.open(bytes)).toThrow(DecodeError);
  });

  it("rejects a key format without the Identifier token", () => {
    expect(() => AssetCatalog.open(buildCar({ keyFormat: [7, 26], facets: { a: 1 } }))).toThrow(
      /17/,
    );
  });

  it("fails the catalog when FACETKEYS, RENDITIONS or LOCALIZATIONKEYS is absent", () => {
    for (const omit of ["FACETKEYS", "RENDITIONS", "LOCALIZATIONKEYS", "KEYFORMAT"]) {
      expect(() => AssetCatalog.open(buildCar({ omit: [omit] }))).toThrow(DecodeError);
    }
  });

  it("reads localizations and appearances; appearances may be absent", () => {
    const withBoth = AssetCatalog.open(
      buildCar({ localizations: { ar: 59797, "zh-Hans": 44691 }, appearances: { dark: 1 } }),
    );
    expect(withBoth.localizations().get("ar")).toBe(59797);
    expect(withBoth.localizations().get("zh-Hans")).toBe(44691);
    expect(withBoth.appearances().get("dark")).toBe(1);
    expect(AssetCatalog.open(buildCar()).appearances().size).toBe(0);
  });

  it("allRenditions lists every rendition, including identifiers no facet names", () => {
    const cat = AssetCatalog.open(
      buildCar({
        facets: { wifi: 42 },
        renditions: [wifi(1), wifi(4), { key: { 17: 77, 26: 4 }, payload: bvg("orphan") }],
      }),
    );
    expect(cat.allRenditions().map((r) => r.key[17]).sort()).toEqual([42, 42, 77]);
  });

  describe("glyph metrics and header", () => {
    /** A csiheader whose tlvLength (1000) exceeds the value and renditionLength is 0. */
    const tooLongTlv = (): Uint8Array => {
      const head = new Uint8Array(184);
      head.set(ascii("ISTC"), 0);
      const v = new DataView(head.buffer);
      v.setUint16(36, 1022, true);
      v.setUint32(168, 1000, true);
      return head;
    };
    const m1018 = concat([le(4, 7, 17), f32s(-1.5, 9.25, 6, 0.5, 0.888672, 0.75, 0.888672)]);
    const open = (r: Partial<RenditionSpec>) =>
      AssetCatalog.open(buildCar({ facets: { wifi: 42 }, renditions: [wifi(4, r)] }));

    it("reads TLV 1018 into metrics", () => {
      const rend = open({ tlv: tlvSection([1, le(4, 9)], [1018, m1018]) }).renditions(42)[0]!;
      expect(rend.metrics).toEqual({
        referencePointSize: 17,
        baselineOffset: -1.5,
        capHeight: 9.25,
        leftInset: 0.5,
        rightInset: 0.75,
      });
    });

    it("leaves metrics absent without a 1018 entry", () => {
      const c = open({ tlv: tlvSection([1, le(4, 9)]) });
      expect(c.renditions(42)[0]!.metrics).toBeUndefined();
      expect(c.skipped.renditions).toBe(0);
    });

    it("notes with a reason a 1018 entry shorter than 36 bytes, keeping the rendition", () => {
      const c = open({ tlv: tlvSection([1018, m1018.subarray(0, 35)]) });
      const rend = c.renditions(42)[0]!;
      expect(rend.metrics).toBeUndefined();
      expect(rend.payload).not.toBeNull();
      expect(c.metricsNotes.some((r) => /1018.*35/.test(r.reason))).toBe(true);
    });

    it("keeps the rendition and its payload when the TLV run is malformed, noting why", () => {
      const bad = concat([le(4, 1018, 100), new Uint8Array(8)]);
      const c = open({ tlv: bad });
      const rend = c.renditions(42)[0]!;
      expect(rend.metrics).toBeUndefined();
      expect(rend.payload).not.toBeNull();
      expect(c.skipped.renditions).toBe(0);
      expect(c.skipped.metrics).toBe(1);
      expect(c.metricsNotes[0]!.reason).toMatch(/TLV entry 1018 of 100 bytes/);
    });

    it("keeps a no-payload rendition whose tlvLength runs past the value", () => {
      const c = AssetCatalog.open(
        buildCar({
          facets: { wifi: 42 },
          renditions: [{ key: { 7: 0, 17: 42, 26: 4 }, payload: null, rawValue: tooLongTlv() }],
        }),
      );
      expect(c.renditions(42)).toHaveLength(1);
      expect(c.skipped.renditions).toBe(0);
      expect(c.metricsNotes[0]!.reason).toMatch(/tlvLength/);
    });

    it("counts a short 1018 as a note, not a skip", () => {
      const c = open({ tlv: tlvSection([1018, m1018.subarray(0, 35)]) });
      expect(c.skipped.renditions).toBe(0);
      expect(c.skipped.metrics).toBe(1);
      expect(c.skipRecords).toEqual([]);
    });

    it("takes the first 1018 entry when there are two", () => {
      const second = concat([le(4, 7, 99), f32s(0, 0, 0, 0, 0, 0, 0)]);
      const rend = open({ tlv: tlvSection([1018, m1018], [1018, second]) }).renditions(42)[0]!;
      expect(rend.metrics!.referencePointSize).toBe(17);
    });

    it("reads coreuiVersion and renditionCount from CARHEADER", () => {
      const c = AssetCatalog.open(
        buildCar({ header: { coreuiVersion: 1010, renditionCount: 157938 } }),
      );
      expect(c.header).toEqual({ coreuiVersion: 1010, renditionCount: 157938 });
    });

    it("has no header, and a note naming both values, when the version string does not name the version", () => {
      const bytes = buildCar({ header: { coreuiVersion: 1010, mainVersionString: "PROJECT:CoreUI-999" } });
      const c = AssetCatalog.open(bytes);
      expect(c.header).toBeUndefined();
      expect(c.headerNote).toMatch(/1010.*CoreUI-999|CoreUI-999.*1010/);
    });

    it("has no header, and a note, without a CARHEADER block", () => {
      const c = AssetCatalog.open(buildCar({ omit: ["CARHEADER"] }));
      expect(c.header).toBeUndefined();
      expect(c.headerNote).toMatch(/no CARHEADER/);
    });

    it("has no note when the header reads", () => {
      expect(AssetCatalog.open(buildCar({ header: { coreuiVersion: 1010 } })).headerNote).toBeUndefined();
    });
  });
});
