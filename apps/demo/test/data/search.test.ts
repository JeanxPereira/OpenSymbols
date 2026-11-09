import { describe, expect, it } from "vitest";
import type { DemoIndex, DemoSymbol } from "../../src/data/index-model.js";
import { search } from "../../src/data/search.js";

function sym(name: string, extra: Partial<DemoSymbol> = {}): DemoSymbol {
  return {
    name,
    component: name,
    aliases: [],
    categories: [],
    searchTerms: [],
    year: null,
    modes: ["monochrome"],
    variableValue: false,
    approximate: [],
    chunk: 0,
    ...extra,
  };
}

function idx(symbols: DemoSymbol[]): DemoIndex {
  return {
    formatVersion: 1,
    package: { name: "x" },
    build: {},
    palette: "stand-in",
    categories: [],
    symbols,
    localized: [],
    skipped: [],
  };
}

const index = idx([
  sym("antenna", { aliases: ["wifi"], categories: ["connectivity"] }),
  sym("wifi.slash", { categories: ["connectivity"] }),
  sym("wifi", { categories: ["connectivity", "communication"] }),
  sym("heart", { searchTerms: ["wifi love"], categories: ["health"] }),
  sym("network.wifi", { categories: [] }),
]);

describe("search", () => {
  it("ranks exact > prefix > token prefix > alias > search term", () => {
    // wifi (2), wifi.slash (1), network.wifi (4), antenna (0, alias), heart (3, term)
    expect(search(index, "wifi")).toEqual([2, 1, 4, 0, 3]);
  });

  it("puts wifi before wifi.slash before the alias hit", () => {
    const r = search(index, "wifi");
    expect(r.indexOf(2)).toBeLessThan(r.indexOf(1));
    expect(r.indexOf(1)).toBeLessThan(r.indexOf(0));
  });

  it("is case-insensitive and splits on . - _ and spaces", () => {
    expect(search(index, "WIFI")).toEqual(search(index, "wifi"));
    expect(search(index, "wifi slash")).toEqual([1]);
    expect(search(index, "wifi-slash")).toEqual([1]);
    expect(search(index, "wifi_slash")).toEqual([1]);
  });

  it("returns everything in index order for an empty query", () => {
    expect(search(index, "")).toEqual([0, 1, 2, 3, 4]);
    expect(search(index, "   ")).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps index order between equal ranks", () => {
    const i = idx([sym("a.star"), sym("b.star"), sym("c.star")]);
    expect(search(i, "star")).toEqual([0, 1, 2]);
  });

  it("filters by category; all and undefined mean no filter", () => {
    expect(search(index, "wifi", "connectivity")).toEqual([2, 1, 0]);
    expect(search(index, "", "health")).toEqual([3]);
    expect(search(index, "wifi", "all")).toEqual(search(index, "wifi"));
    expect(search(index, "", undefined)).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles a symbol with no categories and an unknown category", () => {
    expect(search(index, "", "nope")).toEqual([]);
    expect(search(index, "network", "connectivity")).toEqual([]);
    expect(search(index, "network")).toEqual([4]);
  });

  it("matches nothing for an unknown query", () => {
    expect(search(index, "zzz")).toEqual([]);
  });
  describe("several tokens", () => {
    const multi = idx([
      sym("circle", { aliases: ["fill shape"] }),
      sym("circle.fill"),
      sym("x.wifi.slash"),
      sym("wifi.slash"),
      sym("dot", { searchTerms: ["wifi slash"] }),
      sym("fan", { aliases: ["wifi", "slash"] }),
    ]);
    it("finds symbols whose name has every token as a prefix", () => {
      expect(search(multi, "fill circle")).toContain(1);
      expect(search(multi, "wifi slash").slice(0, 2)).toEqual([3, 2]);
    });
    it("ranks name matches over alias matches over search-term matches", () => {
      expect(search(multi, "wifi slash")).toEqual([3, 2, 5, 4]);
      expect(search(multi, "circle fill")).toEqual([1, 0]);
    });
    it("requires every token", () => {
      expect(search(multi, "wifi zzz")).toEqual([]);
    });
  });
});
