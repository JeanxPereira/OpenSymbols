import { describe, expect, it } from "vitest";
import { assignNames, componentName } from "../../src/generate/names.js";

describe("componentName", () => {
  it("PascalCases words", () => {
    expect(componentName("wifi")).toBe("Wifi");
    expect(componentName("arrow.up.circle.fill")).toBe("ArrowUpCircleFill");
    expect(componentName("square.and.arrow.up.on.square")).toBe("SquareAndArrowUpOnSquare");
    expect(componentName("iphone.gen1")).toBe("IphoneGen1");
  });
  it("splits on any non-alphanumeric character", () => {
    expect(componentName("a.b-c")).toBe("ABC");
    expect(componentName("a_b c")).toBe("ABC");
    expect(componentName("a..b")).toBe("AB");
  });
  it("prefixes Sf for a leading digit", () => {
    expect(componentName("0.circle")).toBe("Sf0Circle");
  });
  it("prefixes Sf for shadowing globals", () => {
    expect(componentName("infinity")).toBe("SfInfinity");
    expect(componentName("map")).toBe("SfMap");
    expect(componentName("function")).toBe("SfFunction");
    expect(componentName("map.fill")).toBe("MapFill");
  });
  it("rejects names with no alphanumerics", () => {
    expect(() => componentName("...")).toThrow(/no letters or digits/);
    expect(() => componentName("")).toThrow();
  });
});

describe("assignNames", () => {
  it("maps symbols to components", () => {
    const r = assignNames(["wifi", "0.circle"], new Map());
    expect([...r.names]).toEqual([["wifi", "Wifi"], ["0.circle", "Sf0Circle"]]);
    expect(r.aliasExports.size).toBe(0);
    expect(r.reports).toEqual([]);
  });
  it("throws naming both symbols on a collision", () => {
    expect(() => assignNames(["x.y", "x-y"], new Map())).toThrow(/"x\.y".*"x-y"|"x-y".*"x\.y"/);
  });
  it("adds alias exports", () => {
    const r = assignNames(["wifi"], new Map([["old.wifi", "wifi"]]));
    expect([...r.aliasExports]).toEqual([["OldWifi", "wifi"]]);
    expect(r.reports).toEqual([]);
  });
  it("skips and reports an alias colliding with a symbol", () => {
    const r = assignNames(["wifi", "old.wifi"], new Map([["old-wifi", "wifi"]]));
    expect(r.aliasExports.size).toBe(0);
    expect(r.names.get("old.wifi")).toBe("OldWifi");
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]).toMatch(/old-wifi/);
  });
  it("first alias wins on alias/alias collision", () => {
    const r = assignNames(["a", "b"], new Map([["x.y", "a"], ["x-y", "b"]]));
    expect([...r.aliasExports]).toEqual([["XY", "a"]]);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]).toMatch(/x-y/);
  });
  it("skips and reports an alias whose modern name is missing", () => {
    const r = assignNames(["a"], new Map([["old", "gone"]]));
    expect(r.aliasExports.size).toBe(0);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]).toMatch(/gone/);
  });
  it("skips and reports an alias with no alphanumerics", () => {
    const r = assignNames(["a"], new Map([["...", "a"]]));
    expect(r.aliasExports.size).toBe(0);
    expect(r.reports).toHaveLength(1);
  });
});
