import { describe, expect, it } from "vitest";
import { Catalog, parseBvg, parseStyleBlock, type BvgDocument } from "@opensymbols/decode";
import { dumpAll, dumpDocument } from "../src/dump.js";
import { buildCar } from "../../decode/test/helpers/build-car.js";
import { buildBplist } from "../../decode/test/helpers/build-plist.js";
import { buildBvg, LIST_0_0_3_5, PATH_Z } from "../../decode/test/helpers/build-bvg.js";
import { buildStyle } from "../../decode/test/helpers/build-style.js";

// Atoms (Docs/format/02 section 3).
const SVG = 0, VIEWBOX = 2, PATH = 3, D = 22, DEFAULTS = 52;
const DRAW_REVERSES = 38, VALUE_MODE = 39, COLOR = 49, FALSE = 54;

const toy = (): Uint8Array =>
  buildBvg({
    typeCode: 0x11,
    localStrings: [LIST_0_0_3_5, PATH_Z],
    root: {
      tag: SVG,
      attrs: [{ name: VIEWBOX, value: 89 }],
      children: [{ tag: PATH, attrs: [{ name: D, value: 90 }], classes: [0] }],
    },
    style: buildStyle({
      indexWidth: 1,
      offsetWidth: 1,
      classes: [{ kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 }],
      rules: [
        [
          { property: VALUE_MODE, values: [COLOR] },
          { property: DRAW_REVERSES, values: [FALSE] },
        ],
      ],
    }),
  });

const dump = (keyFormat?: number[]) => {
  const doc = parseBvg(toy());
  return dumpDocument("toy", { 26: 4, 17: 5, 4: 0 }, doc, parseStyleBlock(doc), keyFormat);
};

describe("dumpDocument", () => {
  it("dumps the toy document in the canonical format, key in KEYFORMAT order", () => {
    expect(dump([4, 17, 26])).toBe(
      [
        "== toy key=4:0,17:5,26:4",
        "viewBox 0 0 3 5",
        "class 0 .defaults rule=0",
        "rule 0 -sfsymbols-variable-value-mode=color -sfsymbols-draw-reverses-motion-groups=false",
        "node svg",
        "node   path class=0",
        "    d Z",
        "",
      ].join("\n"),
    );
  });

  it("is byte-identical across runs", () => {
    expect(dump([26, 17, 4])).toBe(dump([26, 17, 4]));
    expect(dump([26, 17, 4]).startsWith("== toy key=26:4,17:5,4:0\n")).toBe(true);
  });

  it("prints numbers through formatNumber (shortest round-trip, 0 for -0)", () => {
    const base = parseBvg(toy());
    const doc: BvgDocument = {
      ...base,
      root: {
        ...base.root,
        attrs: [
          {
            name: "viewBox",
            nameIndex: 2,
            value: { kind: "list", values: [-0, 0.1 + 0.2, 10.968744000000001] },
          },
        ],
        children: [],
      },
    };
    expect(dumpDocument("n", {}, doc, parseStyleBlock(base))).toContain(
      "viewBox 0 0.30000000000000004 10.968744000000001\n",
    );
  });
});

describe("dumpAll", () => {
  const open = (payload: Uint8Array) =>
    Catalog.open({
      car: buildCar({
        keyFormat: [4, 7, 13, 17, 26],
        facets: { a: 1 },
        localizations: {},
        appearances: {},
        renditions: [
          { key: { 17: 1, 26: 4 }, payload: toy() },
          { key: { 17: 1, 26: 9 }, payload },
        ],
      }),
      bundleFiles: new Map<string, Uint8Array>([
        ["name_availability.plist", buildBplist({ symbols: { a: "2019" }, year_to_release: { "2019": { iOS: "13.0" } } })],
        ["name_aliases.strings", buildBplist({})],
        ["symbol_categories.plist", buildBplist({})],
        ["symbol_search.plist", buildBplist({})],
      ]),
    });

  it("dumps every document in enumeration order", () => {
    const out = dumpAll(open(toy()));
    expect(out.match(/^== /gm)).toHaveLength(2);
    expect(out.startsWith("== a key=4:0,7:0,13:0,17:1,26:4\n")).toBe(true);
  });

  it("names the document and key when one fails to decode", () => {
    expect(() => dumpAll(open(new Uint8Array([1, 2, 3])))).toThrow(
      /dump failed for "a" key=4:0,7:0,13:0,17:1,26:9: /,
    );
  });
});
