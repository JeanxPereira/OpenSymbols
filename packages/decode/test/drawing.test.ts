import { describe, expect, it } from "vitest";
import { DecodeError } from "../src/errors.js";
import { parseBvg } from "../src/bvg/document.js";
import { parseStyleBlock } from "../src/bvg/style.js";
import { decodePath } from "../src/bvg/path.js";
import { buildDrawing, parseStrokeKeyframes, type Drawing } from "../src/drawing.js";
import { buildBvg, LIST_0_0_3_5, PATH_Z, type NodeSpec } from "./helpers/build-bvg.js";
import { buildStyle, type StyleClassSpec, type StyleDeclSpec } from "./helpers/build-style.js";

// Atoms, Docs/format/02 §3.
const SVG = 0, G = 1, VIEWBOX = 2, PATH = 3, RECT = 4, CIRCLE = 5;
const CX = 14, CY = 15, R = 16, FILL = 19, OPACITY = 20, TRANSFORM = 21, D = 22;
const ZERO = 31, ONE = 32, ZERO_F = 33;
const MOTION_GROUP = 34, VAR_THRESHOLD = 35, LAYER_TAGS = 36, ALWAYS_ROTATES = 37;
const DRAW_REVERSES = 38, VALUE_MODE = 39, VC_CONTINUOUS = 40, ALWAYS_PULSES = 41;
const CLEAR_BEHIND = 42, FILL_ACTION = 43, INDICES = 44, VAR_DRAW = 45, ATTACHMENTS = 46;
const WIGGLE_STYLE = 47, ROTATES_CW = 48;
const COLOR = 49, DRAW = 50, ERASE = 51, DEFAULTS = 52, TRUE = 53, FALSE = 54;
const PRIMARY = 55, SECONDARY = 56, TERTIARY = 57, MONOCHROME = 60, KEYFRAMES = 61;
const ID_S = 63, ID_DA = 65, TINT = 86, WHITE = 87, CUSTOM = 88;
const NO_VALUE = 0xff;
const MONO = 0x80, MULTI = 0x81, HIER = 0x82, SHAPE_GROUP = 0x83;

/** Local string pool: returns raw index 89 + i, deduplicated. */
class Pool {
  readonly list: Array<string | Uint8Array> = [];
  s(v: string | Uint8Array): number {
    let i = this.list.indexOf(v);
    if (i < 0) i = this.list.push(v) - 1;
    return 89 + i;
  }
}

const DEFAULTS_RULE: StyleDeclSpec[] = [
  { property: VALUE_MODE, values: [COLOR] },
  { property: DRAW_REVERSES, values: [FALSE] },
];

/** A layer's three family classes, each pointing at the given rule. */
const family = (
  n: number,
  rules: { mono?: number; multi?: number; hier?: number },
  values: { multi?: number; hier?: number } = {},
): StyleClassSpec[] => [
  { kind: MONO, layer: n, value: NO_VALUE, rule: rules.mono ?? 1 },
  { kind: MULTI, layer: n, value: values.multi ?? TINT, rule: rules.multi ?? rules.mono ?? 1 },
  { kind: HIER, layer: n, value: values.hier ?? PRIMARY, rule: rules.hier ?? rules.mono ?? 1 },
];

interface Spec {
  /** Classes after `.defaults` (class index 0). */
  classes: StyleClassSpec[];
  /** Rules after the defaults rule (rule index 0); class `rule` numbers are absolute. */
  rules: StyleDeclSpec[][];
  defaults?: StyleDeclSpec[];
  shapes?: NodeSpec[];
  /** Extra root children after `<g id="s">`. */
  siblings?: NodeSpec[];
  transform?: string;
  rootTag?: number;
  withViewBox?: boolean;
  withS?: boolean;
  extraIds?: Array<{ stringIndex: number; target: NodeSpec }>;
}

function draw(p: Pool, spec: Spec): Drawing {
  const doc = parseBvg(bytes(p, spec));
  return buildDrawing(doc, parseStyleBlock(doc));
}

function bytes(p: Pool, spec: Spec): Uint8Array {
  const style = buildStyle({
    indexWidth: 1,
    offsetWidth: 1,
    classes: [{ kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 }, ...spec.classes],
    rules: [spec.defaults ?? DEFAULTS_RULE, ...spec.rules],
  });
  const s: NodeSpec = {
    tag: G,
    attrs: [{ name: TRANSFORM, value: p.s(spec.transform ?? "matrix(1 0 0 1 0 0)") }],
    children: spec.shapes ?? [],
  };
  const root: NodeSpec = {
    tag: spec.rootTag ?? SVG,
    attrs: spec.withViewBox === false ? [] : [{ name: VIEWBOX, value: p.s(LIST_0_0_3_5) }],
    children: [...(spec.withS === false ? [] : [s]), ...(spec.siblings ?? [])],
  };
  return buildBvg({
    typeCode: 0x11,
    localStrings: p.list,
    idPairs: [
      ...(spec.withS === false ? [] : [{ stringIndex: ID_S, target: s }]),
      ...(spec.extraIds ?? []),
    ],
    root,
    style,
  });
}

const path = (p: Pool, classes: number[], attrs: NodeSpec["attrs"] = []): NodeSpec => ({
  tag: PATH,
  attrs: [{ name: D, value: p.s(PATH_Z) }, ...(attrs ?? [])],
  classes,
});

const expectDecodeError = (f: () => unknown, ...fragments: string[]) => {
  let caught: unknown;
  try {
    f();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DecodeError);
  for (const frag of fragments) expect((caught as Error).message).toContain(frag);
};

/** One layer whose classes all share rule 1 with the given declarations. */
const oneLayer = (p: Pool, decls: StyleDeclSpec[], extra: Partial<Spec> = {}): Spec => ({
  classes: family(0, { mono: 1 }),
  rules: [decls],
  shapes: [path(p, [1, 2, 3])],
  ...extra,
});

describe("buildDrawing (Docs/format/06)", () => {
  it("builds a two-layer symbol with per-layer roles, groups and a knockout", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: [...family(0, { mono: 1 }), ...family(1, { mono: 2 }, { multi: WHITE, hier: SECONDARY })],
      rules: [
        [{ property: MOTION_GROUP, values: [ZERO] }],
        [
          { property: MOTION_GROUP, values: [ONE] },
          { property: OPACITY, values: [ZERO_F] },
          { property: CLEAR_BEHIND, values: [TRUE] },
        ],
      ],
      shapes: [path(p, [1, 2, 3]), path(p, [4, 5, 6])],
    });
    expect(d.layers.length).toBe(2);
    const [l0, l1] = d.layers;
    expect(l0?.role).toBe("primary");
    expect(l0?.motionGroup).toBe(0);
    expect(l0?.familyLayer).toBe(0);
    expect(l0?.modes.monochrome).toEqual({ paint: { kind: "tint" }, opacity: 1, clearBehind: false });
    expect(l0?.modes.hierarchical.paint).toEqual({ kind: "role", role: "primary" });
    expect(l0?.modes.multicolor.paint).toEqual({ kind: "tint" });
    expect(l1?.role).toBe("secondary");
    expect(l1?.motionGroup).toBe(1);
    expect(l1?.familyLayer).toBe(1);
    expect(l1?.modes.monochrome.clearBehind).toBe(true);
    expect(l1?.modes.monochrome.opacity).toBe(0);
    expect(l1?.modes.hierarchical.paint).toEqual({ kind: "role", role: "secondary" });
    expect(l1?.modes.palette.paint).toEqual({ kind: "role", role: "secondary" });
    expect(l1?.modes.multicolor.paint).toEqual({ kind: "named", name: "white" });
    expect(l1?.path).toEqual([{ op: "Z", args: [] }]);
    expect(l1?.tags).toEqual([]);
    expect(l1?.alwaysRotates).toBe(false);
    expect(l1?.alwaysPulses).toBe(false);
    expect(l1?.strokeKeyframes).toEqual([]);
    expect(l1?.attachments).toEqual([]);
    expect(l1?.variableThreshold).toBeUndefined();
    expect(l1?.variableDraw).toBeUndefined();
    expect(d.viewBox).toEqual([0, 0, 3, 5]);
    expect(d.variableValueMode).toBe("color");
    expect(d.drawReversesMotionGroups).toBe(false);
    expect(d.vcContinuous).toBe(false);
    expect(d.wiggleStyle).toBeUndefined();
    expect(d.wiggleAngle).toBeUndefined();
    expect(d.rotatesClockwise).toBeUndefined();
    expect(d.shapeGroups).toEqual([]);
    expect(d.drawAttachmentData).toEqual([]);
  });

  it("reads opacity and the knockout per mode from each mode's painted class (06 §4.5)", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: family(0, { mono: 1, multi: 2, hier: 2 }, { multi: WHITE }),
      rules: [
        [
          { property: MOTION_GROUP, values: [ZERO] },
          { property: OPACITY, values: [ZERO_F] },
          { property: CLEAR_BEHIND, values: [TRUE] },
        ],
        [{ property: MOTION_GROUP, values: [ZERO] }],
      ],
      shapes: [path(p, [1, 2, 3], [{ name: OPACITY, value: ZERO_F }])],
    });
    const m = d.layers[0]?.modes;
    expect(m?.monochrome.clearBehind).toBe(true);
    expect(m?.monochrome.opacity).toBe(0);
    expect(m?.hierarchical.clearBehind).toBe(false);
    expect(m?.hierarchical.opacity).toBe(1);
    expect(m?.palette.clearBehind).toBe(false);
    expect(m?.multicolor.clearBehind).toBe(false);
    expect(m?.multicolor.opacity).toBe(1);
  });

  it("falls back to the structural class for a mode the node has no class of", () => {
    const p = new Pool();
    // Only a monochrome class: every mode's painted class is the structural (monochrome) one.
    const d = draw(p, {
      classes: [{ kind: MONO, layer: 3, value: NO_VALUE, rule: 1 }],
      rules: [[{ property: OPACITY, values: [p.s("0.5")] }, { property: CLEAR_BEHIND, values: [TRUE] }]],
      shapes: [path(p, [1])],
    });
    const l = d.layers[0];
    expect(l?.familyLayer).toBe(3);
    expect(l?.role).toBe("primary");
    for (const m of ["monochrome", "hierarchical", "multicolor", "palette"] as const) {
      expect(l?.modes[m]).toEqual({ paint: { kind: "tint" }, opacity: 0.5, clearBehind: true });
    }
  });

  it("uses the structural fallback mono → multi → hier (06 §4.2)", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: [
        { kind: MULTI, layer: 2, value: TINT, rule: 1 },
        { kind: HIER, layer: 5, value: TERTIARY, rule: 2 },
      ],
      rules: [[{ property: MOTION_GROUP, values: [ONE] }], [{ property: MOTION_GROUP, values: [ZERO] }]],
      shapes: [path(p, [2, 1])],
    });
    expect(d.layers[0]?.familyLayer).toBe(2);
    expect(d.layers[0]?.motionGroup).toBe(1);
    expect(d.layers[0]?.role).toBe("tertiary");
    expect(d.layers[0]?.modes.monochrome.paint).toEqual({ kind: "tint" });
  });

  it("uses the node's opacity attribute only when it has no family class", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: [],
      rules: [],
      shapes: [path(p, [], [{ name: OPACITY, value: p.s("0.25") }]), path(p, [])],
    });
    expect(d.layers[0]?.familyLayer).toBe(-1);
    expect(d.layers[0]?.motionGroup).toBe(0);
    expect(d.layers[0]?.modes.hierarchical).toEqual({ paint: { kind: "tint" }, opacity: 0.25, clearBehind: false });
    expect(d.layers[1]?.modes.monochrome.opacity).toBe(1);
  });

  it("takes the first class of a kind in stored order (06 §4.1)", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: [
        { kind: MONO, layer: 0, value: NO_VALUE, rule: 1 },
        { kind: MONO, layer: 2, value: NO_VALUE, rule: 2 },
      ],
      rules: [[{ property: MOTION_GROUP, values: [p.s("2")] }], [{ property: MOTION_GROUP, values: [ZERO] }]],
      shapes: [path(p, [2, 1])],
    });
    expect(d.layers[0]?.motionGroup).toBe(0);
    expect(d.layers[0]?.familyLayer).toBe(2);
  });

  it("paints a literal hex fill in multicolor only (06 §4.4)", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: family(0, { mono: 1 }, { multi: CUSTOM }),
      rules: [[{ property: MOTION_GROUP, values: [ZERO] }, { property: FILL, values: [p.s("#DDB891")] }]],
      shapes: [path(p, [1, 2, 3], [{ name: FILL, value: p.s("#DDB891") }])],
    });
    const m = d.layers[0]?.modes;
    expect(m?.multicolor.paint).toEqual({ kind: "fixed", hex: "#DDB891" });
    expect(m?.monochrome.paint).toEqual({ kind: "tint" });
    expect(m?.hierarchical.paint).toEqual({ kind: "role", role: "primary" });
  });

  it("keeps custom without a fill as named(custom)", () => {
    const p = new Pool();
    const d = draw(p, { ...oneLayer(p, []), classes: family(0, { mono: 1 }, { multi: CUSTOM }) });
    expect(d.layers[0]?.modes.multicolor.paint).toEqual({ kind: "named", name: "custom" });
  });

  it("rejects a fill starting with # that is not #RRGGBB", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, oneLayer(p, [], { shapes: [path(p, [1, 2, 3], [{ name: FILL, value: p.s("#FFF") }])] })),
      "fill",
      "#FFF",
    );
  });

  it("rejects a hierarchical value outside primary/secondary/tertiary", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, { ...oneLayer(p, []), classes: family(0, { mono: 1 }, { hier: MONOCHROME }) }),
      "monochrome",
    );
  });

  it("turns a circle with cx cy r into a closed four-cubic path (06 §3.3)", () => {
    const p = new Pool();
    const circle: NodeSpec = {
      tag: CIRCLE,
      attrs: [
        { name: CX, value: p.s("5") },
        { name: CY, value: p.s("5") },
        { name: R, value: p.s("2") },
      ],
      classes: [1, 2, 3],
    };
    const d = draw(p, { classes: family(0, { mono: 1 }), rules: [[]], shapes: [circle] });
    const cmds = d.layers[0]?.path ?? [];
    expect(cmds.map((c) => c.op)).toEqual(["M", "C", "C", "C", "C", "Z"]);
    expect(cmds[0]?.args).toEqual([7, 5]);
    expect(cmds[4]?.args.slice(4)).toEqual([7, 5]);
    const xs = cmds.flatMap((c) => c.args.filter((_, i) => i % 2 === 0));
    const ys = cmds.flatMap((c) => c.args.filter((_, i) => i % 2 === 1));
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([3, 3, 7, 7]);
    expect(cmds[1]?.args[1]).toBeCloseTo(5 + 2 * 0.5522847498, 12);
  });

  it("skips a circle without r (a marker) and rejects one with r but no cx", () => {
    const p = new Pool();
    const marker: NodeSpec = { tag: CIRCLE, attrs: [{ name: CX, value: ONE }, { name: CY, value: ONE }] };
    expect(draw(p, { classes: [], rules: [], siblings: [marker] }).layers).toEqual([]);
    const half: NodeSpec = { tag: CIRCLE, attrs: [{ name: CY, value: ONE }, { name: R, value: ONE }] };
    expectDecodeError(() => draw(p, { classes: [], rules: [], shapes: [half] }), "cx");
  });

  it("rejects a shape without d, and a circle number that does not fully parse", () => {
    const p = new Pool();
    expectDecodeError(() => draw(p, { classes: [], rules: [], shapes: [{ tag: RECT }] }), "d");
    const bad: NodeSpec = {
      tag: CIRCLE,
      attrs: [{ name: CX, value: p.s("5px") }, { name: CY, value: ONE }, { name: R, value: ONE }],
    };
    expectDecodeError(() => draw(p, { classes: [], rules: [], shapes: [bad] }), "5px");
  });

  it("reads transform from the first <g id=s>'s matrix(a b c d e f) (06 §2.2)", () => {
    const p = new Pool();
    const d = draw(p, { classes: [], rules: [], transform: "matrix(0.5 0 0 0.5 -1.25,8)" });
    expect(d.transform).toEqual([0.5, 0, 0, 0.5, -1.25, 8]);
  });

  it("rejects a malformed transform, a missing <g id=s>, a non-svg root, a missing viewBox", () => {
    const p = new Pool();
    expectDecodeError(() => draw(p, { classes: [], rules: [], transform: "matrix(1 0 0 1 0)" }), "transform");
    expectDecodeError(() => draw(p, { classes: [], rules: [], transform: "translate(1 2)" }), "transform");
    expectDecodeError(() => draw(p, { classes: [], rules: [], withS: false }), 'id="s"');
    expectDecodeError(() => draw(p, { classes: [], rules: [], rootTag: G }), "svg");
    expectDecodeError(() => draw(p, { classes: [], rules: [], withViewBox: false }), "viewBox");
  });

  it("parses -sfsymbols-clipstroke-attachments per Docs/format/04 §5.2", () => {
    const p = new Pool();
    const v = ["1", "4", "1", "0", "2", "0,1", "4", "0", "2", "1", "1"].map((t) =>
      t === "0" ? ZERO : t === "1" ? ONE : p.s(t),
    );
    const d = draw(p, oneLayer(p, [{ property: ATTACHMENTS, values: v }]));
    expect(d.layers[0]?.attachments).toEqual([
      { flags: 4, targetLayer: 1, targetSubpath: 0, dataIndex: 2, riders: [0] },
      { flags: 4, targetLayer: 0, targetSubpath: 2, dataIndex: 1, riders: [1] },
    ]);
  });

  it("rejects a trailing attachment chunk of fewer than six fields, and format ≠ 1", () => {
    const p = new Pool();
    const short = ["1", "4", "1", "0", "2", "0,1", "4"].map((t) => p.s(t));
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: ATTACHMENTS, values: short }])), "-sfsymbols-clipstroke-attachments");
    const fmt2 = ["2", "4", "1", "0", "2", "0"].map((t) => p.s(t));
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: ATTACHMENTS, values: fmt2 }])), "format");
  });

  it("rejects an unknown closed-vocabulary value, naming property and value (06 §8)", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, { classes: [], rules: [], defaults: [...DEFAULTS_RULE, { property: WIGGLE_STYLE, values: [p.s("zigzag")] }] }),
      "-sfsymbols-wiggle-style",
      "zigzag",
    );
  });

  it("rejects a boolean that is not the atom true/false (04 §3.3)", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, oneLayer(p, [{ property: ALWAYS_ROTATES, values: [ONE] }])),
      "-sfsymbols-always-rotates",
      "1",
    );
  });

  it("rejects a single-valued property with a value count ≠ 1 (04 §3.2)", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, oneLayer(p, [{ property: MOTION_GROUP, values: [ZERO, ONE] }])),
      "-sfsymbols-motion-group",
    );
    expectDecodeError(
      () => draw(p, oneLayer(p, [{ property: OPACITY, values: [] }])),
      "opacity",
    );
    expectDecodeError(
      () => draw(p, oneLayer(p, [{ property: VAR_DRAW, values: [ZERO] }])),
      "-sfsymbols-variable-draw",
    );
  });

  it("rejects a non-integer motion group and a number with trailing characters", () => {
    const p = new Pool();
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: MOTION_GROUP, values: [p.s("1.5")] }])), "1.5");
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: VAR_THRESHOLD, values: [p.s("0.5x")] }])), "0.5x");
  });

  it("rejects an unknown -sfsymbols-* property and a non-sfsymbols property other than opacity/fill", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, oneLayer(p, [{ property: p.s("-sfsymbols-new-thing"), values: [TRUE] }])),
      "-sfsymbols-new-thing",
    );
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: TRANSFORM, values: [ZERO] }])), "transform");
  });

  it("reads the per-layer structural properties (06 §5.1)", () => {
    const p = new Pool();
    const d = draw(
      p,
      oneLayer(p, [
        { property: MOTION_GROUP, values: [p.s("3")] },
        { property: LAYER_TAGS, values: [p.s("wifi"), p.s("_badge")] },
        { property: VAR_THRESHOLD, values: [p.s("0.51")] },
        { property: VAR_DRAW, values: [p.s("0.33"), p.s("0.17")] },
        { property: ALWAYS_ROTATES, values: [TRUE] },
        { property: ALWAYS_PULSES, values: [FALSE] },
      ]),
    );
    const l = d.layers[0];
    expect(l?.motionGroup).toBe(3);
    expect(l?.tags).toEqual(["wifi", "_badge"]);
    expect(l?.variableThreshold).toBe(0.51);
    expect(l?.variableDraw).toEqual([0.33, 0.17]);
    expect(l?.alwaysRotates).toBe(true);
    expect(l?.alwaysPulses).toBe(false);
  });

  it("reads the per-document properties from .defaults (06 §5.2)", () => {
    const p = new Pool();
    const d = draw(p, {
      classes: [],
      rules: [],
      defaults: [
        { property: VALUE_MODE, values: [DRAW] },
        { property: DRAW_REVERSES, values: [TRUE] },
        { property: VC_CONTINUOUS, values: [TRUE] },
        { property: WIGGLE_STYLE, values: [p.s("counterClockwise")] },
        { property: p.s("-sfsymbols-wiggle-angle"), values: [p.s("-30")] },
        { property: ROTATES_CW, values: [FALSE] },
        { property: p.s("-sfsymbols-has-fill-images"), values: [TRUE] },
        { property: p.s("-sfsymbols-fill-image-names"), values: [p.s("x")] },
      ],
    });
    expect(d.variableValueMode).toBe("draw");
    expect(d.drawReversesMotionGroups).toBe(true);
    expect(d.vcContinuous).toBe(true);
    expect(d.wiggleStyle).toBe("counterClockwise");
    expect(d.wiggleAngle).toBe(-30);
    expect(d.rotatesClockwise).toBe(false);
  });

  it("requires -sfsymbols-variable-value-mode (06 §5.2)", () => {
    const p = new Pool();
    expectDecodeError(
      () => draw(p, { classes: [], rules: [], defaults: [{ property: DRAW_REVERSES, values: [TRUE] }] }),
      "-sfsymbols-variable-value-mode",
    );
  });

  it("collects shape groups over the whole tree (06 §7)", () => {
    const p = new Pool();
    const tree: NodeSpec = {
      tag: G,
      children: [
        { tag: G, classes: [1, 2] },
        { tag: G, classes: [3] },
      ],
    };
    const d = draw(p, {
      classes: [
        { kind: SHAPE_GROUP, layer: 0, value: NO_VALUE, rule: 1 },
        { kind: SHAPE_GROUP, layer: 1, value: NO_VALUE, rule: 2 },
        { kind: SHAPE_GROUP, layer: 2, value: NO_VALUE, rule: 3 },
      ],
      rules: [
        [{ property: FILL_ACTION, values: [DRAW] }, { property: INDICES, values: [ZERO, ONE] }],
        [{ property: FILL_ACTION, values: [ERASE] }, { property: INDICES, values: [p.s("2")] }],
        [],
      ],
      siblings: [tree],
    });
    expect(d.shapeGroups).toEqual([
      { layer: 0, fillAction: "draw", indices: [0, 1] },
      { layer: 1, fillAction: "erase", indices: [2] },
      { layer: 2, indices: [] },
    ]);
  });

  it("rejects an unknown fill-action and an empty indices declaration", () => {
    const p = new Pool();
    const sg = (decls: StyleDeclSpec[]): Spec => ({
      classes: [{ kind: SHAPE_GROUP, layer: 0, value: NO_VALUE, rule: 1 }],
      rules: [decls],
      siblings: [{ tag: G, classes: [1] }],
    });
    expectDecodeError(() => draw(p, sg([{ property: FILL_ACTION, values: [p.s("paint")] }])), "-sfsymbols-fill-action", "paint");
    expectDecodeError(() => draw(p, sg([{ property: INDICES, values: [] }])), "-sfsymbols-indices");
  });

  it("reads drawAttachmentData from data-d on the node with id da (06 §6.3)", () => {
    const p = new Pool();
    const da: NodeSpec = {
      tag: G,
      attrs: [{ name: p.s("data-d"), value: p.s("0 1.000000 0.000000 3.643169 3.808577,1 0.3 0 -2") }],
    };
    const d = draw(p, { classes: [], rules: [], siblings: [da], extraIds: [{ stringIndex: ID_DA, target: da }] });
    expect(d.drawAttachmentData).toEqual([
      { a: 1, b: 0, anchorX: 3.643169, anchorY: 3.808577 },
      { a: 1, b: 0.3, anchorX: 0, anchorY: -2 },
    ]);
  });

  it("rejects an unknown or missing data-d version and a partial record (06 §6.3)", () => {
    const p = new Pool();
    const mk = (text: string) => {
      const da: NodeSpec = { tag: G, attrs: [{ name: p.s("data-d"), value: p.s(text) }] };
      return draw(p, { classes: [], rules: [], siblings: [da], extraIds: [{ stringIndex: ID_DA, target: da }] });
    };
    expectDecodeError(() => mk("1 1 0 3 3"), "data-d", "version 1");
    expectDecodeError(() => mk(" "), "data-d", "no version");
    expectDecodeError(() => mk("0 1 0 3"), "data-d");
  });

  it("rejects a path command whose argument count is not a multiple of its arity (03 §3.5)", () => {
    const p = new Pool();
    // Header (03 §3.1), then 0x10: C in immediate mode, nibble 0 (signs +, scale 0), values 1, 2.
    const blob = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x10, 0x01, 0x20]);
    expect(decodePath(blob)).toEqual([{ op: "C", args: [1, 2] }]);
    const bad: NodeSpec = { tag: PATH, attrs: [{ name: D, value: p.s(blob) }], classes: [1, 2, 3] };
    expectDecodeError(
      () => draw(p, oneLayer(p, [], { shapes: [path(p, [1, 2, 3]), bad] })),
      "layer 1",
      "command 0",
      "C has 2 arguments",
    );
  });

  it("rejects a non-finite path number, naming the layer and command", () => {
    const p = new Pool();
    // A huge but finite r: cx + r overflows to Infinity in the circle's path (06 §3.3).
    const circle: NodeSpec = {
      tag: CIRCLE,
      attrs: [
        { name: CX, value: p.s("1.7e308") },
        { name: CY, value: p.s("0") },
        { name: R, value: p.s("1.7e308") },
      ],
      classes: [1, 2, 3],
    };
    expectDecodeError(
      () => draw(p, oneLayer(p, [], { shapes: [circle] })),
      "layer 0",
      "command 0",
      "not finite",
    );
  });

  it("reads data-clipstroke-keyframes on a node (06 §6.1)", () => {
    const p = new Pool();
    // [0, 0, 3, 5]: version 0 with three values, not a multiple of four.
    expectDecodeError(
      () => draw(p, oneLayer(p, [], { shapes: [path(p, [1, 2, 3], [{ name: KEYFRAMES, value: p.s(LIST_0_0_3_5) }])] })),
      "data-clipstroke-keyframes",
    );
  });

  it("takes the last declaration of a property declared twice in one rule (04 §3.5)", () => {
    const p = new Pool();
    const d = draw(
      p,
      oneLayer(p, [
        { property: MOTION_GROUP, values: [ZERO] },
        { property: MOTION_GROUP, values: [p.s("2")] },
      ]),
    );
    expect(d.layers[0]?.motionGroup).toBe(2);
    // Each repeated declaration is still validated.
    expectDecodeError(
      () =>
        draw(p, oneLayer(p, [
          { property: ALWAYS_ROTATES, values: [ONE] },
          { property: ALWAYS_ROTATES, values: [TRUE] },
        ])),
      "-sfsymbols-always-rotates",
    );
  });

  it("skips empty attachment chunks, e.g. after a trailing comma (04 §5.2)", () => {
    const p = new Pool();
    const v = ["1", "4", "1", "0", "2", "0,", ","].map((t) => (t === "1" ? ONE : p.s(t)));
    const d = draw(p, oneLayer(p, [{ property: ATTACHMENTS, values: v }]));
    expect(d.layers[0]?.attachments).toEqual([
      { flags: 4, targetLayer: 1, targetSubpath: 0, dataIndex: 2, riders: [0] },
    ]);
    const one = ["1", "4", "1", "0", "2", "0,", "1"].map((t) => (t === "1" ? ONE : p.s(t)));
    expectDecodeError(() => draw(p, oneLayer(p, [{ property: ATTACHMENTS, values: one }])), "1 fields");
  });

  it("gives palette its own Paint object, deep-equal to hierarchical's", () => {
    const p = new Pool();
    const m = draw(p, oneLayer(p, [])).layers[0]?.modes;
    expect(m?.palette.paint).toEqual(m?.hierarchical.paint);
    expect(m?.palette.paint).not.toBe(m?.hierarchical.paint);
  });

  it("reads data-clipstroke-keyframes end to end from a numeric-list blob (06 §6.1)", () => {
    const p = new Pool();
    // Docs/format/03 §4, hand-encoded: header 0x61 (bit 6 count 1, bit 5 drop last); flags
    // 0x10 (pairs = readValue(1)); nibbles 3 | 0 4 0 1 2 0 → [0, 4, 0, 1, 2, 0] → drop last.
    const blob = new Uint8Array([0x00, 0x61, 0x10, 0x30, 0x40, 0x12, 0x00]);
    const d = draw(
      p,
      oneLayer(p, [], { shapes: [path(p, [1, 2, 3], [{ name: KEYFRAMES, value: p.s(blob) }])] }),
    );
    expect(d.layers[0]?.strokeKeyframes).toEqual([{ flags: 4, progress: 0, d0: 1, d1: 2 }]);
  });
});

describe("parseStrokeKeyframes (Docs/format/06 §6.1)", () => {
  it("reads version-0 records and rejects other versions", () => {
    expect(parseStrokeKeyframes([0, 0, 0.5, 0.72917, 0.230054, 4, 0, 1, 2])).toEqual([
      { flags: 0, progress: 0.5, d0: 0.72917, d1: 0.230054 },
      { flags: 4, progress: 0, d0: 1, d1: 2 },
    ]);
    expect(() => parseStrokeKeyframes([1, 1, 0, 0, 0.5, 0, 1])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([1, 1, 0, 0, 0.5, 0, 1])).toThrow(/version 1/);
  });

  it("rejects a bad record", () => {
    expect(() => parseStrokeKeyframes([])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([0, 1, 0.5, 0])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([0, -1, 0.5, 0, 0])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([0, 1.5, 0.5, 0, 0])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([0, 0, 0.5, -0.1, 0])).toThrow(DecodeError);
    expect(() => parseStrokeKeyframes([0, 0, Number.NaN, 0, 0])).toThrow(DecodeError);
  });
});
