import { describe, expect, it } from "vitest";
import { buildDrawing, Catalog, DecodeError, parseBvg, parseStyleBlock } from "@opensymbols/decode";
import type { Drawing } from "@opensymbols/decode";
import { groupFailures, runGate, sameShape, shapeMismatch } from "../src/gate.js";
import { buildBvg } from "../../decode/test/helpers/build-bvg.js";
import { buildCar } from "../../decode/test/helpers/build-car.js";
import { buildBplist } from "../../decode/test/helpers/build-plist.js";

const bundleFiles = new Map<string, Uint8Array>([
  ["name_availability.plist", buildBplist({ symbols: { a: "2019" }, year_to_release: { "2019": { iOS: "13.0" } } })],
  ["name_aliases.strings", buildBplist({})],
  ["symbol_categories.plist", buildBplist({})],
  ["symbol_search.plist", buildBplist({})],
]);

describe("runGate", () => {
  it("records a failing document and keeps going; a symbol without all masters is incompatible", () => {
    // A bare <svg> parses but has no <g id="s">, so buildDrawing rejects it.
    const bare = buildBvg({ typeCode: 0x11, root: { tag: 0 } });
    const car = buildCar({
      keyFormat: [4, 7, 13, 17, 26],
      facets: { a: 1 },
      localizations: {},
      appearances: {},
      renditions: [
        { key: { 17: 1, 26: 4 }, payload: bare },
        { key: { 17: 1, 26: 1 }, payload: bare },
      ],
    });
    const r = runGate(Catalog.open({ car, bundleFiles }));
    expect(r.documents).toBe(2);
    expect(r.failures.length).toBe(2);
    expect(r.failures[0]?.name).toBe("a");
    expect(r.incompatibleMasters.map((m) => m.name)).toEqual(["a"]);
  });

  it("formats a DecodeError as where: message", () => {
    const bare = buildBvg({ typeCode: 0x11, root: { tag: 0 } });
    const car = buildCar({
      keyFormat: [4, 7, 13, 17, 26],
      facets: { a: 1 },
      localizations: {},
      appearances: {},
      renditions: [{ key: { 17: 1, 26: 4 }, payload: bare }],
    });
    let expected = "";
    try {
      const doc = parseBvg(bare);
      buildDrawing(doc, parseStyleBlock(doc));
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      expected = `${(e as DecodeError).where}: ${(e as DecodeError).message}`;
    }
    const r = runGate(Catalog.open({ car, bundleFiles }));
    expect(r.failures[0]?.error).toBe(expected);
  });

  it("records why masters are incompatible: the missing master and its error", () => {
    const bare = buildBvg({ typeCode: 0x11, root: { tag: 0 } });
    const car = buildCar({
      keyFormat: [4, 7, 13, 17, 26],
      facets: { a: 1 },
      localizations: {},
      appearances: {},
      renditions: [{ key: { 17: 1, 26: 4 }, payload: bare }],
    });
    const r = runGate(Catalog.open({ car, bundleFiles }));
    expect(r.incompatibleMasters).toEqual([
      { name: "a", reason: expect.stringMatching(/^master 1: Catalog: .*no vector rendition for weight 1/) },
    ]);
  });

  it("does not master-check localized facets and counts them", () => {
    const bare = buildBvg({ typeCode: 0x11, root: { tag: 0 } });
    const car = buildCar({
      keyFormat: [4, 7, 13, 17, 26],
      facets: { a: 1, "a.ar": 2 },
      localizations: { ar: 59797 },
      appearances: {},
      renditions: [{ key: { 17: 2, 26: 4 }, payload: bare }],
    });
    const r = runGate(Catalog.open({ car, bundleFiles }));
    expect(r.localized).toBe(1);
    expect(r.incompatibleMasters.map((m) => m.name)).toEqual(["a"]);
  });

  it("counts skipped container records and reports them with their reasons", () => {
    const car = buildCar({
      keyFormat: [4, 7, 13, 17, 26],
      facets: { a: 1 },
      localizations: {},
      appearances: {},
      renditions: [{ key: { 17: 1, 26: 4 }, rawPayload: new TextEncoder().encode("%PDF-1.7") }],
    });
    const r = runGate(Catalog.open({ car, bundleFiles }));
    expect(r.skipped).toBe(1);
    expect(r.skipRecords).toEqual([
      { tree: "RENDITIONS", index: 0, reason: expect.stringMatching(/not DWAR/) },
    ]);
  });
});

describe("groupFailures", () => {
  it("groups identical errors, counting them and keeping the first five distinct names", () => {
    const f = (name: string, error: string) => ({ name, key: {}, error });
    const groups = groupFailures([
      f("a", "X: one"),
      f("b", "X: two"),
      f("a", "X: one"),
      ...["c", "d", "e", "f", "g"].map((n) => f(n, "X: one")),
    ]);
    expect(groups).toEqual([
      { error: "X: one", count: 7, names: ["a", "c", "d", "e", "f"], distinctNames: 6 },
      { error: "X: two", count: 1, names: ["b"], distinctNames: 1 },
    ]);
  });
});

type Cmd = [string, number];
const drawing = (...layers: Cmd[][]): Drawing =>
  ({
    layers: layers.map((cmds) => ({
      path: cmds.map(([op, n]) => ({ op, args: Array.from({ length: n }, () => 0) })),
    })),
  }) as unknown as Drawing;

describe("sameShape / shapeMismatch", () => {
  const base = () => drawing([["M", 2], ["L", 2], ["Z", 0]], [["M", 2], ["Z", 0]]);

  it("accepts equal shapes", () => {
    expect(sameShape(base(), base())).toBe(true);
    expect(shapeMismatch(base(), base())).toBeUndefined();
  });
  it("rejects a differing layer count", () => {
    const b = drawing([["M", 2], ["L", 2], ["Z", 0]]);
    expect(sameShape(base(), b)).toBe(false);
    expect(shapeMismatch(base(), b)).toBe("layer count 2 vs 1");
  });
  it("rejects a differing command count", () => {
    const b = drawing([["M", 2], ["L", 2]], [["M", 2], ["Z", 0]]);
    expect(sameShape(base(), b)).toBe(false);
    expect(shapeMismatch(base(), b)).toBe("command count at layer 0: 3 vs 2");
  });
  it("rejects a differing op at the same position", () => {
    const b = drawing([["M", 2], ["C", 2], ["Z", 0]], [["M", 2], ["Z", 0]]);
    expect(sameShape(base(), b)).toBe(false);
    expect(shapeMismatch(base(), b)).toBe("op at layer 0 cmd 1: L vs C");
  });
  it("rejects a differing argument count", () => {
    const b = drawing([["M", 2], ["L", 6], ["Z", 0]], [["M", 2], ["Z", 0]]);
    expect(sameShape(base(), b)).toBe(false);
    expect(shapeMismatch(base(), b)).toBe("args length at layer 0 cmd 1: 2 vs 6");
  });
});
