// Docs/format/06-drawing.md: a parsed `BVG ` document plus its style block → `Drawing`.
// Rule parsing (04 §3–§5 vocabularies and grammars) is in drawing-properties.ts.
import type { AttrValue, BvgDocument, BvgNode } from "./bvg/document.js";
import type { PathCommand, PathOp } from "./bvg/path.js";
import type { StyleBlock, StyleClass } from "./bvg/style.js";
import {
  type ClipStrokeAttachment,
  parseHex,
  parseNumber,
  parseRule,
  type RuleProps,
  WHERE,
} from "./drawing-properties.js";
import { DecodeError } from "./errors.js";

export type { ClipStrokeAttachment } from "./drawing-properties.js";

// ---- The model, 06 §1 ----

export type RenderingMode = "monochrome" | "hierarchical" | "multicolor" | "palette";
export type LayerRole = "primary" | "secondary" | "tertiary";
/** 06 §4.4. `none` is reserved: no rule produces it on this build. */
export type Paint =
  | { kind: "tint" }
  | { kind: "role"; role: LayerRole }
  | { kind: "named"; name: string }
  | { kind: "fixed"; hex: string }
  | { kind: "none" };

export interface StrokeKeyframe {
  flags: number;
  progress: number;
  d0: number;
  d1: number;
}

/** How a layer is drawn in one rendering mode (06 §1.2, §4.4–§4.5). */
export interface LayerStyle {
  paint: Paint;
  opacity: number;
  clearBehind: boolean;
}

export interface Layer {
  path: PathCommand[];
  modes: Record<RenderingMode, LayerStyle>;
  role: LayerRole;
  motionGroup: number;
  tags: string[];
  variableThreshold?: number;
  variableDraw?: [number, number];
  alwaysRotates: boolean;
  alwaysPulses: boolean;
  strokeKeyframes: StrokeKeyframe[];
  familyLayer: number;
  attachments: ClipStrokeAttachment[];
}

export interface ShapeGroup {
  layer: number;
  fillAction?: "draw" | "erase";
  indices: number[];
}

export interface Drawing {
  viewBox: [number, number, number, number];
  transform: [number, number, number, number, number, number];
  layers: Layer[];
  drawReversesMotionGroups: boolean;
  variableValueMode: "color" | "draw";
  vcContinuous: boolean;
  wiggleStyle?: "linear" | "clockwise" | "counterClockwise";
  wiggleAngle?: number;
  rotatesClockwise?: boolean;
  shapeGroups: ShapeGroup[];
  drawAttachmentData: Array<{ a: number; b: number; anchorX: number; anchorY: number }>;
}

// ---- Atoms used here (02 §3) ----

const TAG_SVG = 0;
const TAG_G = 1;
const TAG_CIRCLE = 5;
const ATTR_VIEWBOX = 2;
const ATTR_CX = 14;
const ATTR_CY = 15;
const ATTR_R = 16;
const ATTR_FILL = 19;
const ATTR_OPACITY = 20;
const ATTR_TRANSFORM = 21;
const ATTR_D = 22;
const ATTR_KEYFRAMES = 61;
/** 02 §5.4: `data-d` is a local string, matched by text. */
const ATTR_DATA_D = "data-d";
/** 02 §4.4: shape tags 3–9. */
const isShape = (tag: number) => tag >= 3 && tag <= 9;
/** 06 §3.3: four-arc circle constant. */
const K = 0.5522847498;

const MODES: readonly RenderingMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];
/** 06 §4.1: the mode class's kind; palette reads the hierarchical class. */
const MODE_KIND = {
  monochrome: "monochrome",
  multicolor: "multicolor",
  hierarchical: "hierarchical",
  palette: "hierarchical",
} as const;
const ROLES: readonly LayerRole[] = ["primary", "secondary", "tertiary"];

// ---- Tree helpers ----

function* preOrder(node: BvgNode): Generator<BvgNode> {
  yield node;
  for (const c of node.children) yield* preOrder(c);
}

function attr(node: BvgNode, nameIndex: number): AttrValue | undefined {
  return node.attrs.find((a) => a.nameIndex === nameIndex)?.value;
}

function attrText(node: BvgNode, nameIndex: number, field: string): string | undefined {
  const v = attr(node, nameIndex);
  if (v === undefined) return undefined;
  if (v.kind !== "string") throw new DecodeError(WHERE, `${field}: expected text, found a ${v.kind} blob`);
  return v.text;
}

/** Text split on spaces and commas (02 §5.3, 06 §6.3). */
const tokens = (text: string) => text.split(/[\s,]+/).filter((t) => t !== "");

/** A numeric-list attribute: the decoded list, or an atom's text read as numbers (02 §5.1). */
function numbers(v: AttrValue, field: string): number[] {
  if (v.kind === "list") return v.values;
  if (v.kind === "string") return tokens(v.text).map((t) => parseNumber(t, field));
  throw new DecodeError(WHERE, `${field}: expected a numeric list, found a path`);
}

// ---- 06 §2 the document frame ----

function readViewBox(root: BvgNode): Drawing["viewBox"] {
  // 06 §2.1: root is svg (tag 0) with a viewBox of exactly four numbers.
  if (root.tagIndex !== TAG_SVG) throw new DecodeError(WHERE, `root is "${root.tag}", not svg (06 §2.1)`);
  const v = attr(root, ATTR_VIEWBOX);
  if (v === undefined) throw new DecodeError(WHERE, "root has no viewBox (06 §2.1)");
  const n = numbers(v, "viewBox");
  if (n.length !== 4) throw new DecodeError(WHERE, `viewBox has ${n.length} numbers, not 4 (06 §2.1)`);
  return n as Drawing["viewBox"];
}

function readTransform(root: BvgNode): Drawing["transform"] {
  // 06 §2.2: the first `g` with id `s` in depth-first pre-order; matrix(a b c d e f).
  let s: BvgNode | undefined;
  for (const n of preOrder(root)) {
    if (n.tagIndex === TAG_G && n.id === "s") {
      s = n;
      break;
    }
  }
  if (s === undefined) throw new DecodeError(WHERE, 'no <g id="s"> (06 §2.2)');
  const text = attrText(s, ATTR_TRANSFORM, "transform");
  const m = text === undefined ? null : /^\s*matrix\(([^()]*)\)\s*$/.exec(text);
  const parts = m ? tokens(m[1] as string) : [];
  if (parts.length !== 6) {
    throw new DecodeError(WHERE, `transform "${text ?? ""}" is not matrix(a b c d e f) (06 §2.2)`);
  }
  return parts.map((t) => parseNumber(t, "transform")) as Drawing["transform"];
}

// ---- 06 §3 geometry ----

function circlePath(node: BvgNode): PathCommand[] {
  // 06 §3.3: cx, cy, r as plain numeric strings; four cubics, k = 0.5522847498.
  const num = (i: number, name: string) => {
    const t = attrText(node, i, `circle ${name}`);
    if (t === undefined) throw new DecodeError(WHERE, `circle with r has no ${name} (06 §3.3)`);
    return parseNumber(t, `circle ${name}`);
  };
  const r = num(ATTR_R, "r");
  const cx = num(ATTR_CX, "cx");
  const cy = num(ATTR_CY, "cy");
  const k = r * K;
  return [
    { op: "M", args: [cx + r, cy] },
    { op: "C", args: [cx + r, cy + k, cx + k, cy + r, cx, cy + r] },
    { op: "C", args: [cx - k, cy + r, cx - r, cy + k, cx - r, cy] },
    { op: "C", args: [cx - r, cy - k, cx - k, cy - r, cx, cy - r] },
    { op: "C", args: [cx + k, cy - r, cx + r, cy - k, cx + r, cy] },
    { op: "Z", args: [] },
  ];
}

function shapePath(node: BvgNode): PathCommand[] {
  if (node.tagIndex === TAG_CIRCLE) return circlePath(node);
  // 06 §3.2, §3.4: every other shape needs a decoded `d`.
  const d = attr(node, ATTR_D);
  if (d?.kind !== "path") throw new DecodeError(WHERE, `${node.tag} node has no decodable d (06 §3.2)`);
  return d.commands;
}

/**
 * 06 §6.1: `data-clipstroke-keyframes` tokens. Version 0: records of four after the version;
 * any other version is an error, so a new build's change surfaces.
 */
export function parseStrokeKeyframes(values: number[]): StrokeKeyframe[] {
  const field = "data-clipstroke-keyframes";
  if (values.length === 0) throw new DecodeError(WHERE, `${field}: empty, no version (06 §6.1)`);
  if (values[0] !== 0) {
    throw new DecodeError(WHERE, `${field}: version ${values[0]} is not 0, the only one read (06 §6.1)`);
  }
  const rest = values.slice(1);
  if (rest.length % 4 !== 0) {
    throw new DecodeError(WHERE, `${field}: ${rest.length} values after version 0, not a multiple of 4 (06 §6.1)`);
  }
  const out: StrokeKeyframe[] = [];
  for (let i = 0; i < rest.length; i += 4) {
    const [flags, progress, d0, d1] = rest.slice(i, i + 4) as [number, number, number, number];
    const ok =
      Number.isInteger(flags) &&
      flags >= 0 &&
      flags < 2 ** 32 &&
      Number.isFinite(progress) &&
      Number.isFinite(d0) &&
      d0 >= 0 &&
      Number.isFinite(d1) &&
      d1 >= 0;
    if (!ok) {
      throw new DecodeError(WHERE, `${field}: bad record ${i / 4}: ${flags} ${progress} ${d0} ${d1} (06 §6.1)`);
    }
    out.push({ flags, progress, d0, d1 });
  }
  return out;
}

// ---- 06 §6.3 data-d ----

function readDrawAttachmentData(root: BvgNode): Drawing["drawAttachmentData"] {
  for (const n of preOrder(root)) {
    if (n.id !== "da") continue;
    const a = n.attrs.find((x) => x.name === ATTR_DATA_D);
    if (a === undefined) continue;
    if (a.value.kind !== "string") throw new DecodeError(WHERE, "data-d: not literal text (02 §5.4)");
    const t = tokens(a.value.text);
    // 06 §6.3: version 0 is the only one read; anything else surfaces.
    if (t[0] === undefined) throw new DecodeError(WHERE, "data-d: no version token (06 §6.3)");
    if (t[0] !== "0") throw new DecodeError(WHERE, `data-d: version ${t[0]} is not 0 (06 §6.3)`);
    const rest = t.slice(1);
    if (rest.length % 4 !== 0) {
      throw new DecodeError(WHERE, `data-d: ${rest.length} values after version 0, not a multiple of 4 (06 §6.3)`);
    }
    const out: Drawing["drawAttachmentData"] = [];
    for (let i = 0; i < rest.length; i += 4) {
      const [a0, b, x, y] = rest.slice(i, i + 4).map((v) => parseNumber(v, "data-d")) as [number, number, number, number];
      out.push({ a: a0, b, anchorX: x, anchorY: y });
    }
    return out;
  }
  return [];
}

// ---- 06 §3.5 path integrity ----

/**
 * Arguments per drawing step (03 §3.5): a command carries one or more steps' arguments,
 * since a set of runs appends values in pairs whatever the arity; Z takes none.
 */
const ARITY: Record<PathOp, number> = {
  M: 2, m: 2, L: 2, l: 2, T: 2, t: 2,
  C: 6, c: 6,
  S: 4, s: 4, Q: 4, q: 4,
  H: 1, h: 1, V: 1, v: 1,
  Z: 0,
};

/** 06 §3.5: every command's argument count fits its op and every number is finite. */
function checkPath(path: PathCommand[], layer: number): void {
  path.forEach((c, j) => {
    const arity = ARITY[c.op];
    const ok = arity === 0 ? c.args.length === 0 : c.args.length % arity === 0;
    if (!ok) {
      throw new DecodeError(
        WHERE,
        `layer ${layer} command ${j}: ${c.op} has ${c.args.length} arguments, not a multiple of ${arity} (06 §3.5)`,
      );
    }
    const k = c.args.findIndex((x) => !Number.isFinite(x));
    if (k >= 0) {
      throw new DecodeError(WHERE, `layer ${layer} command ${j}: argument ${k} (${c.args[k]}) is not finite (06 §3.5)`);
    }
  });
}

// ---- Assembly ----

export function buildDrawing(doc: BvgDocument, style: StyleBlock): Drawing {
  // Every rule a class points at is read (and validated) once, so an unknown property or
  // value anywhere in the block surfaces (06 §8). Orphan rules (04 §1.2) are not read.
  const props = new Map<number, RuleProps>();
  for (const c of style.classes) {
    if (!props.has(c.ruleIndex)) props.set(c.ruleIndex, parseRule(style.rules[c.ruleIndex] ?? []));
  }
  const ruleOf = (c: StyleClass) => props.get(c.ruleIndex) as RuleProps;

  const classAt = (i: number): StyleClass => {
    const c = style.classes[i];
    if (c === undefined) throw new DecodeError(WHERE, `class index ${i} names no class (02 §4.3)`);
    return c;
  };
  // 06 §4.1: first class of the kind, in stored order.
  const firstOf = (node: BvgNode, kind: StyleClass["kind"]) =>
    node.classIndices.map(classAt).find((c) => c.kind === kind);

  const layers: Layer[] = [];
  const shapeGroups: ShapeGroup[] = [];

  // 06 §3.1: layers from shape nodes, pre-order, not descending into a shape node.
  const walk = (node: BvgNode) => {
    if (isShape(node.tagIndex)) {
      // 06 §3.1, §9.2: a circle without r is a marker, not a layer.
      if (node.tagIndex === TAG_CIRCLE && attr(node, ATTR_R) === undefined) return;
      const layer = buildLayer(node);
      checkPath(layer.path, layers.length);
      layers.push(layer);
      return;
    }
    for (const c of node.children) walk(c);
  };

  const buildLayer = (node: BvgNode): Layer => {
    const mono = firstOf(node, "monochrome");
    const multi = firstOf(node, "multicolor");
    const hier = firstOf(node, "hierarchical");
    // 06 §4.2: structural class = monochrome, else multicolor, else hierarchical.
    const structural = mono ?? multi ?? hier;
    const sp: RuleProps = structural ? ruleOf(structural) : {};

    // 06 §4.3: role from the hierarchical value; none → primary.
    let role: LayerRole = "primary";
    if (hier !== undefined) {
      if (!(ROLES as readonly (string | undefined)[]).includes(hier.value)) {
        throw new DecodeError(WHERE, `${hier.name}: unknown hierarchical value "${hier.value ?? ""}" (06 §4.3)`);
      }
      role = hier.value as LayerRole;
    }

    // 06 §4.4: multicolor paint — literal fill, else the multicolor value, else tint.
    let multiPaint: Paint = { kind: "tint" };
    const fill = attrText(node, ATTR_FILL, "fill");
    if (fill !== undefined && fill.startsWith("#")) {
      multiPaint = { kind: "fixed", hex: parseHex(fill, "fill") };
    } else if (multi !== undefined) {
      if (multi.value === undefined) throw new DecodeError(WHERE, `${multi.name}: multicolor class without a value (04 §2.2)`);
      multiPaint = multi.value === "tintColor" ? { kind: "tint" } : { kind: "named", name: multi.value };
    }
    const hierPaint: Paint = hier !== undefined ? { kind: "role", role } : { kind: "tint" };
    const paint: Record<RenderingMode, Paint> = {
      monochrome: { kind: "tint" },
      hierarchical: hierPaint,
      // Its own object: no two modes share a Paint, so one cannot change another.
      palette: { ...hierPaint },
      multicolor: multiPaint,
    };

    // 06 §4.5: opacity / knockout from each mode's painted class; the node attribute only
    // when the node has no family class at all.
    let nodeOpacity = 1;
    if (structural === undefined) {
      const t = attrText(node, ATTR_OPACITY, "opacity");
      if (t !== undefined) nodeOpacity = parseNumber(t, "opacity");
    }
    const byKind = { monochrome: mono, multicolor: multi, hierarchical: hier };
    const modes = {} as Record<RenderingMode, LayerStyle>;
    for (const m of MODES) {
      const painted = byKind[MODE_KIND[m]] ?? structural;
      const pp: RuleProps = painted ? ruleOf(painted) : {};
      modes[m] = {
        paint: paint[m],
        opacity: painted ? (pp.opacity ?? 1) : nodeOpacity,
        clearBehind: pp.clearBehind ?? false,
      };
    }

    const kf = attr(node, ATTR_KEYFRAMES);
    const layer: Layer = {
      path: shapePath(node),
      modes,
      role,
      // 06 §5.1 defaults for absent declarations.
      motionGroup: sp.motionGroup ?? 0,
      tags: sp.tags ?? [],
      alwaysRotates: sp.alwaysRotates ?? false,
      alwaysPulses: sp.alwaysPulses ?? false,
      strokeKeyframes: kf ? parseStrokeKeyframes(numbers(kf, "data-clipstroke-keyframes")) : [],
      familyLayer: structural?.layer ?? -1,
      attachments: sp.attachments ?? [],
    };
    if (sp.variableThreshold !== undefined) layer.variableThreshold = sp.variableThreshold;
    if (sp.variableDraw !== undefined) layer.variableDraw = sp.variableDraw;
    return layer;
  };

  walk(doc.root);

  // 06 §7: shape groups over the whole tree, every 0x83 class in stored order.
  for (const n of preOrder(doc.root)) {
    for (const i of n.classIndices) {
      const c = classAt(i);
      if (c.kind !== "shapeGroupLayer") continue;
      const p = ruleOf(c);
      const g: ShapeGroup = { layer: c.layer, indices: p.indices ?? [] };
      if (p.fillAction !== undefined) g.fillAction = p.fillAction;
      shapeGroups.push(g);
    }
  }

  // 06 §5.2: `.defaults` is the named class whose value is atom 52.
  const defaultsClass = style.classes.find((c) => c.kind === "named" && c.value === ".defaults");
  const dp: RuleProps = defaultsClass ? ruleOf(defaultsClass) : {};
  if (dp.variableValueMode === undefined) {
    throw new DecodeError(WHERE, "no -sfsymbols-variable-value-mode on .defaults (06 §5.2)");
  }

  const drawing: Drawing = {
    viewBox: readViewBox(doc.root),
    transform: readTransform(doc.root),
    layers,
    drawReversesMotionGroups: dp.drawReversesMotionGroups ?? false,
    variableValueMode: dp.variableValueMode,
    vcContinuous: dp.vcContinuous ?? false,
    shapeGroups,
    drawAttachmentData: readDrawAttachmentData(doc.root),
  };
  if (dp.wiggleStyle !== undefined) drawing.wiggleStyle = dp.wiggleStyle;
  if (dp.wiggleAngle !== undefined) drawing.wiggleAngle = dp.wiggleAngle;
  // 06 §5.2: absent rotates-clockwise stays unset, which is not false.
  if (dp.rotatesClockwise !== undefined) drawing.rotatesClockwise = dp.rotatesClockwise;
  return drawing;
}
