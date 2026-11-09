import { describe, expect, it } from "vitest";
import { DecodeError } from "../../src/errors.js";
import { parseBvg } from "../../src/bvg/document.js";
import { parseStyleBlock } from "../../src/bvg/style.js";
import { buildBvg } from "../helpers/build-bvg.js";
import { buildStyle, ruleOffsetOf, type BuildStyleOptions } from "../helpers/build-style.js";

const DEFAULTS = 52; // atom ".defaults"
const TINT = 86; // atom "tintColor"
const PRIMARY = 55; // atom "primary"
const MOTION_GROUP = 34;
const LAYER_TAGS = 36;
const ONE = 32; // atom "1"
const NO_VALUE = 0xff;

const doc = (typeCode: number, style: number[]) =>
  parseBvg(buildBvg({ typeCode, localStrings: ["a", "b"], root: { tag: 1 }, style }));

const base = (iw: 1 | 2 | 4, ow: 1 | 2 | 4): BuildStyleOptions => ({
  indexWidth: iw,
  offsetWidth: ow,
  classes: [
    { kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 },
    { kind: 0x80, layer: 0, value: NO_VALUE, rule: 1 },
    { kind: 0x81, layer: 0, value: TINT, rule: 1 },
    { kind: 0x82, layer: 0, value: PRIMARY, rule: 1 },
  ],
  rules: [
    [{ property: 38, values: [53] }],
    [
      { property: MOTION_GROUP, values: [ONE] },
      { property: LAYER_TAGS, values: [89, 90] },
    ],
  ],
});

describe.each([
  ["<u8,u8>", 0x11, 1, 1],
  ["<u16,u16>", 0x22, 2, 2],
] as const)("parseStyleBlock %s (Docs/format/04 §1-2)", (_n, typeCode, iw, ow) => {
  it("names classes and shares one rule across a layer's modes", () => {
    const sb = parseStyleBlock(doc(typeCode, buildStyle(base(iw, ow))));
    expect(sb.classes.map((c) => c.name)).toEqual([
      ".defaults",
      ".monochrome-0",
      ".multicolor-0:tintColor",
      ".hierarchical-0:primary",
    ]);
    expect(sb.classes.map((c) => c.kind)).toEqual(["named", "monochrome", "multicolor", "hierarchical"]);
    expect(sb.classes[1]?.value).toBeUndefined();
    expect(sb.classes[2]?.value).toBe("tintColor");
    expect(sb.classes[0]?.ruleIndex).toBe(0);
    expect(sb.classes.slice(1).map((c) => c.ruleIndex)).toEqual([1, 1, 1]);
    const rule = sb.rules[1] ?? [];
    expect(rule[0]).toEqual({ property: "-sfsymbols-motion-group", propertyIndex: 34, values: ["1"] });
    expect(rule[1]).toEqual({ property: "-sfsymbols-layer-tags", propertyIndex: 36, values: ["a", "b"] });
    expect(sb.orphanRules).toEqual([]);
  });

  it("rejects a high-bit-clear kind other than 0 and a family kind >= 4", () => {
    for (const kind of [0x01, 0x84, 0xff]) {
      const o = base(iw, ow);
      o.classes[1] = { kind, layer: 0, value: NO_VALUE, rule: 1 };
      expect(() => parseStyleBlock(doc(typeCode, buildStyle(o)))).toThrow(DecodeError);
    }
  });

  it("rejects a ruleOffset that lands mid-rule", () => {
    const o = base(iw, ow);
    o.classes[1] = { kind: 0x80, layer: 0, value: NO_VALUE, ruleOffset: ruleOffsetOf(o, 1) + 1 };
    expect(() => parseStyleBlock(doc(typeCode, buildStyle(o)))).toThrow(DecodeError);
  });

  it("reports a rule no class points at", () => {
    const o = base(iw, ow);
    o.rules.push([{ property: MOTION_GROUP, values: [ONE] }]);
    expect(parseStyleBlock(doc(typeCode, buildStyle(o))).orphanRules).toEqual([2]);
  });

  it("rejects string indices that name nothing", () => {
    const o = base(iw, ow);
    o.classes[2] = { kind: 0x81, layer: 0, value: 200, rule: 1 };
    expect(() => parseStyleBlock(doc(typeCode, buildStyle(o)))).toThrow(DecodeError);
  });
});

describe("parseStyleBlock details", () => {
  it("reads a local-string multicolor value and the layer number", () => {
    const o = base(1, 1);
    o.classes[2] = { kind: 0x81, layer: 3, value: 89, rule: 1 };
    expect(parseStyleBlock(doc(0x11, buildStyle(o))).classes[2]?.name).toBe(".multicolor-3:a");
  });

  it("names shapeGroupLayer classes", () => {
    const o = base(1, 1);
    o.classes.push({ kind: 0x83, layer: 2, value: NO_VALUE, rule: 1 });
    const c = parseStyleBlock(doc(0x11, buildStyle(o))).classes[4];
    expect(c?.kind).toBe("shapeGroupLayer");
    expect(c?.name).toBe(".shapeGroupLayer-2");
  });

  it("compares the no-value sentinel as the number 255, not all-ones, at u16", () => {
    const o = base(2, 2);
    o.classes[2] = { kind: 0x81, layer: 0, value: 0xffff, rule: 1 };
    expect(() => parseStyleBlock(doc(0x22, buildStyle(o)))).toThrow(DecodeError);
    o.classes[2] = { kind: 0x81, layer: 0, value: 0xff, rule: 1 };
    const c = parseStyleBlock(doc(0x22, buildStyle(o))).classes[2];
    expect(c?.name).toBe(".multicolor-0");
    expect(c?.value).toBeUndefined();
  });

  it("rejects truncated data", () => {
    const bytes = buildStyle(base(1, 1)).slice(0, -2);
    expect(() => parseStyleBlock(doc(0x11, bytes))).toThrow(DecodeError);
  });

  it("accepts an empty block with zero classes", () => {
    expect(parseStyleBlock(doc(0x11, [0]))).toEqual({ classes: [], rules: [], orphanRules: [] });
  });
});
