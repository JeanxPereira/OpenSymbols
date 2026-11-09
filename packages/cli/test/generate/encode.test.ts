import { describe, expect, it } from "vitest";
import { Catalog, DecodeError } from "@opensymbols/decode";
import { FORMAT_VERSION } from "@opensymbols/core";
import { encodeSymbol, round3, round6 } from "../../src/generate/encode.js";
import { buildPalette, STAND_IN_PALETTE } from "../../src/generate/stand-in-palette.js";
import { EncodeError } from "../../src/errors.js";
import { buildCar, f32s, le, tlvSection, type RenditionSpec } from "../../../decode/test/helpers/build-car.js";
import { buildBplist } from "../../../decode/test/helpers/build-plist.js";
import { buildBvg, LIST_0_0_3_5, type NodeSpec } from "../../../decode/test/helpers/build-bvg.js";
import { buildStyle, type StyleClassSpec } from "../../../decode/test/helpers/build-style.js";
import { nibbles, PATH_HEADER } from "../../../decode/test/helpers/nibbles.js";

// Atoms, Docs/format/02 section 3.
const SVG = 0, G = 1, VIEWBOX = 2, PATH = 3, TRANSFORM = 21, D = 22;
const MOTION_GROUP = 34, DRAW_REVERSES = 38, VALUE_MODE = 39, ALWAYS_PULSES = 41;
const COLOR = 49, DEFAULTS = 52, TRUE = 53, FALSE = 54, PRIMARY = 55, SECONDARY = 56;
const ONE = 32, ID_S = 63, SYSTEM_BLUE = 73, SYSTEM_TEAL = 84, TINT = 86, WHITE = 87, CUSTOM = 88;
const NO_VALUE = 0xff;
const MONO = 0x80, MULTI = 0x81, HIER = 0x82;

// Paths (Docs/format/03 section 3), nibble-encoded as in decode's path tests.
const path = (...ns: number[]) => nibbles(...PATH_HEADER, ...ns);
/** M 3 5 L 1 2 Z */
const P_MLZ = path(0, 0, 0, 3, 5, 0, 0, 0, 1, 2, 7, 0);
/** M 4 5 L 1 3 Z */
const P_MLZ_WIDE = path(0, 0, 0, 4, 5, 0, 0, 0, 1, 3, 7, 0);
/** M 3 5 l 1 2 Z: same shape as P_MLZ but a relative second command. */
const P_MlZ = path(0, 0, 0, 3, 5, 8, 0, 0, 1, 2, 7, 0);
/** M 3 5 L 1 2 L 1 2 Z: one extra command. */
const P_MLLZ = path(0, 0, 0, 3, 5, 0, 0, 0, 1, 2, 0, 0, 0, 1, 2, 7, 0);
/** M 1 1 Z */
const P_MZ = path(0, 0, 0, 1, 1, 7, 0);

interface LayerSpec {
  d: Uint8Array;
  multi?: number;
  hier?: number;
}

/** A symbol document: `<svg viewBox="0 0 3 5"><g id="s" transform=…>` with one path per layer. */
function symbolDoc(layers: LayerSpec[], transform = "matrix(1 0 0 1 0 0)"): Uint8Array {
  const pool: Array<string | Uint8Array> = [];
  const s = (v: string | Uint8Array) => {
    let i = pool.indexOf(v);
    if (i < 0) i = pool.push(v) - 1;
    return 89 + i;
  };
  const classes: StyleClassSpec[] = [{ kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 }];
  const shapes: NodeSpec[] = layers.map((l, n) => {
    const first = classes.length;
    classes.push(
      { kind: MONO, layer: n, value: NO_VALUE, rule: n === 0 ? 1 : 2 },
      { kind: MULTI, layer: n, value: l.multi ?? TINT, rule: n === 0 ? 1 : 2 },
      { kind: HIER, layer: n, value: l.hier ?? PRIMARY, rule: n === 0 ? 1 : 2 },
    );
    return { tag: PATH, attrs: [{ name: D, value: s(l.d) }], classes: [first, first + 1, first + 2] };
  });
  const style = buildStyle({
    indexWidth: 1,
    offsetWidth: 1,
    classes,
    rules: [
      [
        { property: VALUE_MODE, values: [COLOR] },
        { property: DRAW_REVERSES, values: [TRUE] },
      ],
      [{ property: MOTION_GROUP, values: [ONE] }],
      [{ property: ALWAYS_PULSES, values: [TRUE] }],
    ],
  });
  const g: NodeSpec = { tag: G, attrs: [{ name: TRANSFORM, value: s(transform) }], children: shapes };
  const root: NodeSpec = { tag: SVG, attrs: [{ name: VIEWBOX, value: s(LIST_0_0_3_5) }], children: [g] };
  return buildBvg({ typeCode: 0x11, localStrings: pool, idPairs: [{ stringIndex: ID_S, target: g }], root, style });
}

const metricsTlv = (referencePointSize: number) =>
  tlvSection([
    1018,
    new Uint8Array([...le(4, 7, referencePointSize), ...f32s(0.1, 9.25, 6, 0.5, 0.888672, 0.75, 0.888672)]),
  ]);

// Key format: Direction, Appearance, Localization, Identifier, GlyphWeight.
const KEY_FORMAT = [4, 7, 13, 17, 26];
const rend = (id: number, weight: number, layers: LayerSpec[], extra: Record<number, number> = {}): RenditionSpec => ({
  key: { 17: id, 26: weight, ...extra },
  payload: symbolDoc(layers, `matrix(1 0 0 1 ${weight} 0)`),
  tlv: metricsTlv(weight * 10),
});
const allMasters = (id: number, at: (m: number) => LayerSpec[], extra: Record<number, number> = {}) =>
  [1, 4, 9].map((m) => rend(id, m, at(m), extra));

const two = (m: number): LayerSpec[] => [{ d: m === 9 ? P_MLZ_WIDE : P_MLZ }, { d: P_MZ, hier: SECONDARY }];

const car = buildCar({
  keyFormat: KEY_FORMAT,
  facets: { two: 1, extra: 2, blue: 3, dark: 4, pair: 5, op: 6, odd: 7, snow: 8, teal: 9, custom: 10, sparse: 11, thin: 12, corrupt: 13, bare: 14 },
  appearances: { "NSAppearanceNameDarkAqua": 1, "NSAppearanceNameAccessibility": 3 },
  renditions: [
    ...allMasters(1, two),
    // black master has one extra command in layer 0
    ...allMasters(2, (m) => [{ d: m === 9 ? P_MLLZ : P_MLZ }, { d: P_MZ }]),
    ...allMasters(3, () => [{ d: P_MZ, multi: SYSTEM_BLUE }]),
    ...allMasters(4, () => [{ d: P_MZ }], { 7: 0 }),
    ...allMasters(4, () => [{ d: P_MLZ }], { 7: 1 }),
    ...allMasters(5, () => [{ d: P_MLZ }], { 4: 5 }),
    ...allMasters(5, () => [{ d: P_MZ }], { 4: 4 }),
    // ultralight master turns the L into an l
    ...allMasters(6, (m) => [{ d: m === 1 ? P_MlZ : P_MLZ }]),
    ...allMasters(7, () => [{ d: P_MZ }], { 7: 0 }),
    ...allMasters(7, () => [{ d: P_MZ }], { 7: 3 }),
    ...allMasters(8, () => [{ d: P_MZ, multi: WHITE }]),
    ...allMasters(9, () => [{ d: P_MZ, multi: SYSTEM_TEAL }]),
    ...allMasters(10, () => [{ d: P_MZ, multi: CUSTOM }, { d: P_MZ, multi: CUSTOM }]),
    // dark stored only at direction 4
    ...allMasters(11, () => [{ d: P_MZ }], { 4: 4, 7: 0 }),
    ...allMasters(11, () => [{ d: P_MLZ }], { 4: 4, 7: 1 }),
    ...allMasters(11, () => [{ d: P_MLZ }], { 4: 5, 7: 0 }),
    // only an ultralight master: no pair has a regular rendition
    rend(12, 1, [{ d: P_MZ }]),
    // dark at direction 0 is stored but its regular rendition is not a BVG document
    ...allMasters(13, () => [{ d: P_MZ }], { 7: 0 }),
    { key: { 17: 13, 26: 4, 7: 1 }, payload: new TextEncoder().encode("not a BVG"), tlv: metricsTlv(40) },
    // no TLV 1018 at any master
    ...[1, 4, 9].map((m) => ({ key: { 17: 14, 26: m }, payload: symbolDoc([{ d: P_MZ }]) })),
  ],
});

const bundleFiles = new Map(Object.entries({
  "name_availability.plist": buildBplist({ symbols: { two: "2019" }, year_to_release: {} }),
}));

const catalog = (appFiles?: Map<string, Uint8Array>) =>
  Catalog.open(appFiles === undefined ? { car, bundleFiles } : { car, bundleFiles, appFiles });

/** An Apple palette with only systemBlueColor: white is exact, systemTealColor a stand-in. */
const PALETTE = buildPalette({
  light: new Map([["systemBlueColor", "#0088ff"]]),
  dark: new Map([["systemBlueColor", "#0091ff"]]),
});

const encode = (name: string, opts: Partial<Parameters<typeof encodeSymbol>[2]> = {}, c = catalog()) =>
  encodeSymbol(c, c.resolve(name)!, { masters: "all", palette: PALETTE, validated: true, ...opts });

const thrown = (f: () => unknown): Error => {
  try {
    f();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw");
};

describe("encodeSymbol", () => {
  it("encodes a 2-layer symbol to one variant with ops, layer ranges and three masters", () => {
    const s = encode("two");
    expect(s.v).toBe(FORMAT_VERSION);
    expect(s.name).toBe("two");
    expect(s.palette).toBe("apple");
    expect(Object.keys(s.variants)).toEqual(["a0d0"]);
    expect(s.defaultVariant).toBe("a0d0");
    expect(s.modes).toEqual(["monochrome", "hierarchical", "multicolor", "palette"]);
    const v = s.variants.a0d0!;
    expect(v.ops).toBe("MLZMZ");
    expect(v.argCounts).toEqual([2, 2, 0, 2, 0]);
    expect(v.layers.map((l) => l.cmd)).toEqual([[0, 3], [3, 5]]);
    expect(Object.keys(v.masters).sort()).toEqual(["1", "4", "9"]);
    expect(v.masters[4]!.args).toEqual([3, 5, 1, 2, 1, 1]);
    expect(v.masters[1]!.args).toEqual([3, 5, 1, 2, 1, 1]);
    expect(v.masters[9]!.args).toEqual([4, 5, 1, 3, 1, 1]);
    expect(v.masters[9]!.viewBox).toEqual([0, 0, 3, 5]);
    expect(v.masters[9]!.transform).toEqual([1, 0, 0, 1, 9, 0]);
    expect(v.masters[4]!.metrics).toEqual({
      referencePointSize: 40,
      baselineOffset: 0.1, // float32 0.10000000149011612, rounded
      capHeight: 9.25,
      leftInset: 0.5,
      rightInset: 0.75,
    });
    expect(v.variableValueMode).toBe("color");
    expect(v.vcContinuous).toBe(false);
    expect(v.anim).toEqual({ drawReversesMotionGroups: true, shapeGroups: [], drawAttachmentData: [] });
  });

  it("writes build.validated from the options", () => {
    expect(encode("two").build).toEqual({ validated: true });
    expect(encode("two", { validated: false }).build).toEqual({ validated: false });
  });

  it("encodes a symbol whose masters carry no metrics (TLV 1018), without metrics, and warns", () => {
    const warnings: string[] = [];
    const s = encode("bare", { warnings });
    const v = s.variants.a0d0!;
    expect(Object.keys(v.masters).sort()).toEqual(["1", "4", "9"]);
    for (const m of [1, 4, 9] as const) {
      expect(v.masters[m]!.metrics).toBeUndefined();
      expect("metrics" in v.masters[m]!).toBe(false);
    }
    expect(warnings.some((w) => w.includes('"bare"') && /no glyph metrics/.test(w))).toBe(true);
  });

  it("carries role, per-mode styles, motion group and the remaining Layer fields", () => {
    const [l0, l1] = encode("two").variants.a0d0!.layers;
    expect(l0!.role).toBe("primary");
    expect(l0!.motionGroup).toBe(1);
    expect(l0!.modes.monochrome).toEqual({ paint: { kind: "tint" }, opacity: 1, clearBehind: false });
    expect(l0!.modes.hierarchical.paint).toEqual({ kind: "role", role: "primary" });
    expect(l0!.anim).toEqual({
      tags: [],
      alwaysRotates: false,
      alwaysPulses: false,
      strokeKeyframes: [],
      familyLayer: 0,
      attachments: [],
    });
    expect(l0!.variableThreshold).toBeUndefined();
    expect("variableThreshold" in l0!).toBe(false);
    expect(l1!.role).toBe("secondary");
    expect(l1!.modes.palette.paint).toEqual({ kind: "role", role: "secondary" });
    expect(l1!.anim?.alwaysPulses).toBe(true);
  });

  it("--masters regular keeps only master 4", () => {
    const v = encode("two", { masters: "regular" }).variants.a0d0!;
    expect(Object.keys(v.masters)).toEqual(["4"]);
    // and does not compare masters it does not read
    expect(Object.keys(encode("extra", { masters: "regular" }).variants.a0d0!.masters)).toEqual(["4"]);
  });

  it("throws naming the symbol and the first mismatch when the black master has an extra command", () => {
    const e = thrown(() => encode("extra"));
    expect(e).toBeInstanceOf(EncodeError);
    expect((e as EncodeError).symbol).toBe("extra");
    expect(e.message).toContain('"extra"');
    expect(e.message).toContain("master 9");
    expect(e.message).toContain("layer 0");
    expect(e.message).toContain("command 2");
  });

  it("names the differing op when a master changes a command", () => {
    const e = thrown(() => encode("op"));
    expect(e).toBeInstanceOf(EncodeError);
    expect(e.message).toContain('"op"');
    expect(e.message).toContain("master 1");
    expect(e.message).toContain("layer 0 command 1");
    expect(e.message).toContain('"l"');
    expect(e.message).toContain('"L"');
  });

  it("resolves a multicolor systemBlueColor layer through the palette", () => {
    const l = encode("blue").variants.a0d0!.layers[0]!;
    expect(l.modes.multicolor.paint).toEqual({ kind: "named", name: "systemBlueColor", light: "#0088ff", dark: "#0091ff" });
    expect(l.modes.monochrome.paint).toEqual({ kind: "tint" });
  });

  it("a resolved symbol is apple only when every named colour is apple or exact", () => {
    expect(encode("blue").palette).toBe("apple");
    const snow = encode("snow");
    expect(snow.palette).toBe("apple");
    expect(snow.variants.a0d0!.layers[0]!.modes.multicolor.paint).toEqual({
      kind: "named",
      name: "white",
      light: "#ffffff",
      dark: "#ffffff",
    });
    const teal = encode("teal");
    expect(teal.palette).toBe("stand-in");
    expect(teal.variants.a0d0!.layers[0]!.modes.multicolor.paint).toEqual({
      kind: "named",
      name: "systemTealColor",
      light: STAND_IN_PALETTE.light.get("systemTealColor"),
      dark: STAND_IN_PALETTE.dark.get("systemTealColor"),
    });
    // a symbol with no named colour at all keeps the palette's source
    expect(encode("two").palette).toBe("apple");
  });

  it("a colour in no palette is drawn in the tint, marks the symbol stand-in and warns once", () => {
    const warnings: string[] = [];
    const s = encode("custom", { warnings });
    expect(s.palette).toBe("stand-in");
    expect(s.variants.a0d0!.layers.map((l) => l.modes.multicolor.paint)).toEqual([{ kind: "tint" }, { kind: "tint" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"custom"');
    expect(warnings[0]).toContain('symbol "custom"');
  });

  it('says palette "stand-in" when the stand-in palette is passed', () => {
    const s = encode("blue", { palette: STAND_IN_PALETTE });
    expect(s.palette).toBe("stand-in");
    const paint = s.variants.a0d0!.layers[0]!.modes.multicolor.paint;
    expect(paint).toEqual({
      kind: "named",
      name: "systemBlueColor",
      light: STAND_IN_PALETTE.light.get("systemBlueColor"),
      dark: STAND_IN_PALETTE.dark.get("systemBlueColor"),
    });
  });

  it("keys appearance variants a0 and a1 (the dark appearance), default first", () => {
    const s = encode("dark");
    expect(Object.keys(s.variants)).toEqual(["a0d0", "a1d0"]);
    expect(s.defaultVariant).toBe("a0d0");
    expect(s.variants.a0d0!.ops).toBe("MZ");
    expect(s.variants.a1d0!.ops).toBe("MLZ");
  });

  it("keys direction variants by their stored direction, lowest first", () => {
    const s = encode("pair");
    expect(Object.keys(s.variants)).toEqual(["a0d4", "a0d5"]);
    expect(s.defaultVariant).toBe("a0d4");
    expect(s.variants.a0d4!.ops).toBe("MZ");
    expect(s.variants.a0d5!.ops).toBe("MLZ");
  });

  it("skips a (direction, appearance) pair with no rendition and warns", () => {
    const warnings: string[] = [];
    const s = encode("sparse", { warnings });
    expect(Object.keys(s.variants)).toEqual(["a0d4", "a1d4", "a0d5"]);
    expect(s.defaultVariant).toBe("a0d4");
    expect(s.variants.a1d4!.ops).toBe("MLZ");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('symbol "sparse"');
    expect(warnings[0]).toContain("a1d5");
  });

  it("a pair whose regular rendition exists but is corrupt fails the symbol, not a warning", () => {
    const warnings: string[] = [];
    expect(() => encode("corrupt", { warnings })).toThrow(DecodeError);
    expect(warnings).toEqual([]);
  });

  it("throws when no pair encodes at all", () => {
    const warnings: string[] = [];
    const e = thrown(() => encode("thin", { warnings }));
    expect(e).toBeInstanceOf(EncodeError);
    expect((e as EncodeError).symbol).toBe("thin");
    expect(warnings).toHaveLength(1);
  });

  it("keeps a non-dark appearance id and records a warning", () => {
    const warnings: string[] = [];
    const s = encode("odd", { warnings });
    expect(Object.keys(s.variants)).toEqual(["a0d0", "a3d0"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"odd"');
    expect(warnings[0]).toContain("NSAppearanceNameAccessibility");
  });

  it("takes the dark appearance without accessibility or contrast in its name over one with", () => {
    const c2 = Catalog.open({
      car: buildCar({
        keyFormat: KEY_FORMAT,
        facets: { dk: 1 },
        appearances: { NSAppearanceNameAccessibilityHighContrastDarkAqua: 2, NSAppearanceNameDarkAqua: 5 },
        renditions: [
          ...allMasters(1, () => [{ d: P_MZ }], { 7: 0 }),
          ...allMasters(1, () => [{ d: P_MLZ }], { 7: 2 }),
          ...allMasters(1, () => [{ d: P_MLZ }], { 7: 5 }),
        ],
      }),
      bundleFiles,
    });
    const s = encode("dk", {}, c2);
    expect(Object.keys(s.variants).sort()).toEqual(["a0d0", "a1d0", "a2d0"]);
    expect(s.variants.a1d0!.ops).toBe("MLZ");
  });

  it("takes modes from layerset availability when the app files carry it", () => {
    const c = catalog(
      new Map([
        [
          "layerset_availability.plist",
          buildBplist({ symbols: { two: { hierarchical: "2019" } }, year_to_release: {} }),
        ],
      ]),
    );
    expect(encode("two", {}, c).modes).toEqual(["monochrome", "hierarchical", "palette"]);
    // a symbol the file does not list has only the two modes every symbol has (05 section 3.4)
    expect(encode("blue", {}, c).modes).toEqual(["monochrome", "palette"]);
    // an app/ without the file says nothing about modes
    expect(encode("two", {}, catalog(new Map())).modes).toEqual(["monochrome", "hierarchical", "multicolor", "palette"]);
  });
});

describe("round3", () => {
  it("rounds to 3 decimals and never yields -0", () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(-0.0004)).toBe(0);
    expect(Object.is(round3(-0.0004), 0)).toBe(true);
    expect(round3(10)).toBe(10);
  });
});

describe("round6", () => {
  it("keeps 6 significant digits and never yields -0", () => {
    expect(round6(0.8886719942092896)).toBe(0.888672);
    expect(round6(17)).toBe(17);
    expect(round6(-1.5)).toBe(-1.5);
    expect(Object.is(round6(-0), 0)).toBe(true);
  });
});

describe("buildPalette", () => {
  it("layers Apple's colours over the stand-ins and keeps each name's origin", () => {
    const p = buildPalette({
      light: new Map([["systemTealColor", "#111111"]]),
      dark: new Map([["systemTealColor", "#222222"]]),
    });
    expect(p.source).toBe("apple");
    expect(p.light.get("systemTealColor")).toBe("#111111");
    expect(p.dark.get("systemTealColor")).toBe("#222222");
    expect(p.origin.get("systemTealColor")).toBe("apple");
    expect(p.origin.get("systemRedColor")).toBe("stand-in");
    expect(p.light.get("white")).toBe("#ffffff");
    expect(p.origin.get("white")).toBe("exact");
    expect(p.light.get("black")).toBe("#000000");
    expect(p.origin.get("black")).toBe("exact");
  });

  it("without Apple's file is a stand-in copy that does not share maps", () => {
    const p = buildPalette();
    expect(p.source).toBe("stand-in");
    expect(p.light).toEqual(STAND_IN_PALETTE.light);
    p.light.set("x", "#000000");
    expect(STAND_IN_PALETTE.light.has("x")).toBe(false);
  });
});

describe("STAND_IN_PALETTE", () => {
  // Docs/format/02 section 3, atoms 66-88: the multicolor colour vocabulary, without
  // `tintColor` (the decoder maps it to tint) and `custom` (a literal fill, not a name).
  const COLOUR_ATOMS = [
    "black", "controlAccentColor", "knockout", "labelColor", "secondaryLabelColor",
    "tertiaryLabelColor", "quaternaryLabelColor", "systemBlueColor", "systemBrownColor",
    "systemCyanColor", "systemGrayColor", "systemGreenColor", "systemIndigoColor",
    "systemMintColor", "systemOrangeColor", "systemPinkColor", "systemPurpleColor",
    "systemRedColor", "systemTealColor", "systemYellowColor", "white",
  ];

  it("covers every colour atom in light and dark with lowercase CSS hex", () => {
    expect(STAND_IN_PALETTE.source).toBe("stand-in");
    for (const name of COLOUR_ATOMS) {
      expect(STAND_IN_PALETTE.light.get(name), name).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      expect(STAND_IN_PALETTE.dark.get(name), name).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
    expect([...STAND_IN_PALETTE.light.keys()].sort()).toEqual([...COLOUR_ATOMS].sort());
    expect([...STAND_IN_PALETTE.dark.keys()].sort()).toEqual([...COLOUR_ATOMS].sort());
  });
});
