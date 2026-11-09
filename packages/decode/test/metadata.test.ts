import { describe, expect, it } from "vitest";
import { DecodeError } from "../src/errors.js";
import { loadAppMetadata, loadBundleMetadata } from "../src/metadata.js";
import { buildBplist } from "./helpers/build-plist.js";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const files = (entries: Record<string, Uint8Array>): Map<string, Uint8Array> =>
  new Map(Object.entries(entries));

const nameAvailability = buildBplist({
  symbols: { "0.circle": "2019", "star.fill": "2019.1" },
  year_to_release: {
    "2019": { iOS: "13.0", macOS: "10.15" },
    "2019.1": { iOS: "13.1" },
  },
});

describe("loadBundleMetadata (Docs/format/05 §2)", () => {
  it("with only name_availability.plist gives empty maps elsewhere", () => {
    const m = loadBundleMetadata(files({ "name_availability.plist": nameAvailability }));
    expect([...m.availability]).toEqual([
      ["0.circle", "2019"],
      ["star.fill", "2019.1"],
    ]);
    expect(m.yearToRelease.get("2019")).toEqual({ iOS: "13.0", macOS: "10.15" });
    expect(m.aliasToModern.size).toBe(0);
    expect(m.nofillToFill.size).toBe(0);
    expect(m.categories).toEqual([]);
    expect(m.symbolCategories.size).toBe(0);
    expect(m.order).toEqual([]);
    expect(m.searchTerms.size).toBe(0);
    expect(m.restrictions.size).toBe(0);
  });

  it("names name_availability.plist when it is missing", () => {
    expect(() => loadBundleMetadata(new Map())).toThrow(DecodeError);
    expect(() => loadBundleMetadata(new Map())).toThrow(/name_availability\.plist/);
  });

  it("reads every optional file", () => {
    const m = loadBundleMetadata(
      files({
        "name_availability.plist": nameAvailability,
        "name_aliases.strings": buildBplist({ "old.name": "new.name" }),
        "nofill_to_fill.strings": buildBplist({ star: "star.fill" }),
        "categories.plist": buildBplist([{ key: "all", icon: "square.grid.2x2" }]),
        "symbol_categories.plist": buildBplist({ "star.fill": ["all", "shapes"] }),
        "symbol_order.plist": buildBplist(["star.fill", "0.circle"]),
        "symbol_search.plist": buildBplist({ "star.fill": ["favorite", "rating"] }),
        "symbol_restrictions.strings": buildBplist({ "apple.logo": "Do not use" }),
      }),
    );
    expect(m.aliasToModern.get("old.name")).toBe("new.name");
    expect(m.nofillToFill.get("star")).toBe("star.fill");
    expect(m.categories).toEqual([{ key: "all", icon: "square.grid.2x2", label: "" }]);
    expect(m.symbolCategories.get("star.fill")).toEqual(["all", "shapes"]);
    expect(m.order).toEqual(["star.fill", "0.circle"]);
    expect(m.searchTerms.get("star.fill")).toEqual(["favorite", "rating"]);
    expect(m.restrictions.get("apple.logo")).toBe("Do not use");
  });

  it("errors on a present file that has the wrong shape or does not parse", () => {
    expect(() =>
      loadBundleMetadata(
        files({
          "name_availability.plist": nameAvailability,
          "symbol_order.plist": buildBplist({ a: "b" }),
        }),
      ),
    ).toThrow(/symbol_order\.plist/);
    expect(() =>
      loadBundleMetadata(
        files({ "name_availability.plist": nameAvailability, "name_aliases.strings": text("junk") }),
      ),
    ).toThrow(DecodeError);
  });
});

const header =
  "Color Name,Symbol App Ready,Light Primary,Light Secondary,Light Tertiary,Dark Primary,Dark Secondary,Dark Tertiary,macOS Color Name,Light Standard,Light Vibrant Standard,Dark Standard,Dark Vibrant Standard";
const row = (name: string, light: string, dark: string): string =>
  `blue,TRUE,100,50,18,100,50,25,${name},"${light}","1, 2, 3",${dark === "" ? "" : `"${dark}"`},"4, 5, 6"`;

describe("loadAppMetadata (Docs/format/05 §3)", () => {
  it("returns empty maps and no palette for no files", () => {
    const m = loadAppMetadata(new Map());
    expect(m.categoryLabels.size).toBe(0);
    expect(m.baseSymbols.size).toBe(0);
    expect(m.layersetAvailability.size).toBe(0);
    expect(m.palette).toBeUndefined();
  });

  it("reads categories.plist labels from XML", () => {
    const m = loadAppMetadata(
      files({
        "categories.plist": text(
          `<?xml version="1.0"?><plist version="1.0"><array><dict><key>key</key><string>privacyandsecurity</string><key>icon</key><string>lock</string><key>label</key><string>Privacy &amp; Security</string></dict></array></plist>`,
        ),
      }),
    );
    expect(m.categoryLabels.get("privacyandsecurity")).toBe("Privacy & Security");
  });

  it("reads base_symbols_map.json in file order and rejects a shared variant", () => {
    const m = loadAppMetadata(
      files({ "base_symbols_map.json": text('{"0.circle":["0.circle.fill"],"a":["a.x","a.y"]}') }),
    );
    expect([...m.baseSymbols]).toEqual([
      ["0.circle", ["0.circle.fill"]],
      ["a", ["a.x", "a.y"]],
    ]);
    expect(() =>
      loadAppMetadata(files({ "base_symbols_map.json": text('{"a":["v"],"b":["v"]}') })),
    ).toThrow(/"v"/);
    expect(() => loadAppMetadata(files({ "base_symbols_map.json": text("[1]") }))).toThrow(
      DecodeError,
    );
    expect(() => loadAppMetadata(files({ "base_symbols_map.json": text("{nope") }))).toThrow(
      DecodeError,
    );
  });

  it("maps layerset availability to rendering modes", () => {
    const plist = text(
      `<?xml version="1.0"?><plist version="1.0"><dict>
        <key>symbols</key><dict>
          <key>a</key><dict><key>hierarchical</key><string>2022</string><key>multicolor</key><string>2023</string></dict>
          <key>b</key><dict><key>multicolor</key><string>2021</string></dict>
          <key>c</key><dict/>
        </dict>
        <key>year_to_release</key><dict/>
      </dict></plist>`,
    );
    const m = loadAppMetadata(files({ "layerset_availability.plist": plist }));
    expect(m.layersetAvailability.get("a")).toEqual(["monochrome", "hierarchical", "multicolor", "palette"]);
    expect(m.layersetAvailability.get("b")).toEqual(["monochrome", "multicolor", "palette"]);
    expect(m.layersetAvailability.get("c")).toEqual(["monochrome", "palette"]);
  });

  describe("colors-26.csv (§3.6)", () => {
    const palette = (csv: string) => loadAppMetadata(files({ "colors-26.csv": text(csv) })).palette;

    it("converts two rows to CSS colours", () => {
      const p = palette(
        [
          header,
          row("systemBlueColor", "0, 122, 255", "10, 132, 255"),
          row("labelColor", "0, 0, 0, 85", "255, 255, 255, 100"),
        ].join("\n"),
      );
      expect(p?.light.get("systemBlueColor")).toBe("#007aff");
      expect(p?.dark.get("systemBlueColor")).toBe("#0a84ff");
      expect(p?.light.get("labelColor")).toBe("#000000d9");
      expect(p?.dark.get("labelColor")).toBe("#ffffff");
    });

    it("rounds half up and keeps fractional alpha", () => {
      const p = palette([header, row("quinaryLabelColor", "0, 0, 0, 1.5", "0, 0, 0, 5")].join("\r\n"));
      expect(p?.light.get("quinaryLabelColor")).toBe("#00000004");
      expect(p?.dark.get("quinaryLabelColor")).toBe("#0000000d");
    });

    it("finds columns by header text, tolerates a BOM, reordering and blank lines", () => {
      const csv = '﻿"Dark Standard", "macOS Color Name",Light Standard\n\n"1, 2, 3","redColor","255, 56, 60"\n';
      const p = palette(csv);
      expect(p?.light.get("redColor")).toBe("#ff383c");
      expect(p?.dark.get("redColor")).toBe("#010203");
    });

    it("rejects a missing column, listing the header cells it found", () => {
      expect(() => palette("Color Name,macOS Color Name,Light Standard\nx,y,\"1, 2, 3\"")).toThrow(
        /Dark Standard.*Color Name/s,
      );
    });

    it("rejects an empty or malformed required cell naming row, column and text", () => {
      expect(() => palette([header, row("a", "", "1, 2, 3")].join("\n"))).toThrow(
        /a.*Light Standard/s,
      );
      expect(() => palette([header, row("a", "97, 97 101", "1, 2, 3")].join("\n"))).toThrow(
        /97, 97 101/,
      );
      expect(() => palette([header, row("a", "1, 2, 300", "1, 2, 3")].join("\n"))).toThrow(DecodeError);
      expect(() => palette([header, row("a", "1, 2, 3, 101", "1, 2, 3")].join("\n"))).toThrow(
        DecodeError,
      );
      expect(() => palette([header, row("a", "1, 2", "1, 2, 3")].join("\n"))).toThrow(DecodeError);
    });

    it("rejects an empty or duplicate key", () => {
      expect(() => palette([header, row("", "1, 2, 3", "1, 2, 3")].join("\n"))).toThrow(DecodeError);
      expect(() =>
        palette([header, row("a", "1, 2, 3", "1, 2, 3"), row("a", "1, 2, 3", "1, 2, 3")].join("\n")),
      ).toThrow(/duplicate/i);
    });

    it("ignores columns it does not read (empty vibrant cells)", () => {
      const csv = `${header}\nblue,TRUE,,,,,,,systemBlueColor,"0, 122, 255",,"10, 132, 255",\n`;
      expect(palette(csv)?.light.get("systemBlueColor")).toBe("#007aff");
    });
  });
});
