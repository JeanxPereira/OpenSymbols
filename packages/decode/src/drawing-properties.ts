// Typed reading of one style rule's declarations: Docs/format/04 §3–§5 (vocabularies, value
// counts, grammars) as applied by Docs/format/06 §5–§8. Layer and document assembly live in
// drawing.ts.
import { LOCAL_BASE } from "./bvg/atoms.js";
import type { Declaration } from "./bvg/style.js";
import { DecodeError } from "./errors.js";

export const WHERE = "BVG drawing";

export interface ClipStrokeAttachment {
  flags: number;
  targetLayer: number;
  targetSubpath: number;
  dataIndex: number;
  riders: number[];
}

/** Every property a rule may declare, typed. Absent = not declared. */
export interface RuleProps {
  // 06 §5.1, per layer
  motionGroup?: number;
  tags?: string[];
  variableThreshold?: number;
  variableDraw?: [number, number];
  alwaysRotates?: boolean;
  alwaysPulses?: boolean;
  attachments?: ClipStrokeAttachment[];
  clearBehind?: boolean;
  opacity?: number;
  fill?: string;
  // 06 §5.2, per document
  variableValueMode?: "color" | "draw";
  drawReversesMotionGroups?: boolean;
  vcContinuous?: boolean;
  wiggleStyle?: "linear" | "clockwise" | "counterClockwise";
  wiggleAngle?: number;
  rotatesClockwise?: boolean;
  // 06 §7, per shape group
  fillAction?: "draw" | "erase";
  indices?: number[];
}

/** 06 §8: a number parses only if the whole token is a decimal number. */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumber(text: string, field: string): number {
  const n = NUMBER.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(n)) throw new DecodeError(WHERE, `${field}: "${text}" is not a number (06 §8)`);
  return n;
}

function parseInteger(text: string, field: string): number {
  const n = parseNumber(text, field);
  if (!Number.isInteger(n)) throw new DecodeError(WHERE, `${field}: "${text}" is not an integer (06 §8)`);
  return n;
}

function parseIndex(text: string, field: string): number {
  const n = parseInteger(text, field);
  if (n < 0) throw new DecodeError(WHERE, `${field}: "${text}" is negative (04 §5.2)`);
  return n;
}

/** 06 §4.4 [INF]: `#` and six hex digits, either case, kept as written. */
export function parseHex(text: string, field: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(text)) {
    throw new DecodeError(WHERE, `${field}: "${text}" is not #RRGGBB (06 §4.4)`);
  }
  return text;
}

/** 04 §3.2 [INF]: a single-valued property with a value count other than one is malformed. */
function single(d: Declaration): string {
  if (d.values.length !== 1) {
    throw new DecodeError(
      WHERE,
      `${d.property}: ${d.values.length} values where exactly one is required (04 §3.2, 06 §5.1)`,
    );
  }
  return d.values[0] as string;
}

/** 04 §3.4, §4.2: a closed vocabulary; any other value is an error naming both. */
function oneOf<T extends string>(d: Declaration, vocabulary: readonly T[]): T {
  const v = single(d);
  if (!(vocabulary as readonly string[]).includes(v)) {
    throw new DecodeError(WHERE, `${d.property}: unknown value "${v}" (04 §4.2)`);
  }
  return v as T;
}

/** 04 §3.3: booleans are the atoms `true` / `false` only, never `1` / `0`. */
function bool(d: Declaration): boolean {
  return oneOf(d, ["true", "false"] as const) === "true";
}

/**
 * 04 §5.2: join the values with spaces, split on `,`, split each part on whitespace;
 * each part is `format flags targetLayer targetSubpath dataIndex rider…`. `format` must be 1
 * and is not stored (06 §6.2); one to five fields is an error. An empty part (e.g. after a
 * trailing `,`) separates nothing and is skipped (04 §5.2 [INF]).
 */
export function parseAttachments(values: string[], property: string): ClipStrokeAttachment[] {
  if (values.length === 0) throw new DecodeError(WHERE, `${property}: no values (04 §5.2)`);
  return values
    .join(" ")
    .split(",")
    .map((part) => part.split(/\s+/).filter((t) => t !== ""))
    .filter((f) => f.length > 0)
    .map((f, i) => {
      const field = `${property} attachment ${i}`;
      if (f.length < 6) {
        throw new DecodeError(WHERE, `${field}: ${f.length} fields, at least six required (04 §5.2)`);
      }
      const [format, flags, targetLayer, targetSubpath, dataIndex, ...riders] = f.map((t) =>
        parseIndex(t, field),
      ) as [number, number, number, number, number, ...number[]];
      if (format !== 1) throw new DecodeError(WHERE, `${field}: format ${format} is not 1 (04 §5.2)`);
      return { flags, targetLayer, targetSubpath, dataIndex, riders };
    });
}

// 02 §3 atom numbers of the properties (06 §5).
const P_FILL = 19;
const P_OPACITY = 20;
const P_MOTION_GROUP = 34;
const P_VARIABLE_THRESHOLD = 35;
const P_LAYER_TAGS = 36;
const P_ALWAYS_ROTATES = 37;
const P_DRAW_REVERSES = 38;
const P_VALUE_MODE = 39;
const P_VC_CONTINUOUS = 40;
const P_ALWAYS_PULSES = 41;
const P_CLEAR_BEHIND = 42;
const P_FILL_ACTION = 43;
const P_INDICES = 44;
const P_VARIABLE_DRAW = 45;
const P_ATTACHMENTS = 46;
const P_WIGGLE_STYLE = 47;
const P_ROTATES_CLOCKWISE = 48;
// 04 §5.4: local-string properties, matched by text.
const L_WIGGLE_ANGLE = "-sfsymbols-wiggle-angle";
/** 04 §4.1, §5.4: in the census, read by nothing; not surfaced (06 §5.2). */
const L_IGNORED = new Set(["-sfsymbols-has-fill-images", "-sfsymbols-fill-image-names"]);

/**
 * Read one rule into typed properties. Atom properties dispatch by string index, local ones
 * by text (06 §5). Every value is validated where it is read, so an unknown property or
 * value surfaces as a `DecodeError` naming it (06 §8, 04 §3.4).
 */
export function parseRule(decls: Declaration[]): RuleProps {
  const out: RuleProps = {};
  // 04 §3.5 [INF]: declarations are read in stored order, each validated; a property
  // declared twice in one rule takes its LAST declaration (CSS cascade order).
  for (const d of decls) {
    if (d.propertyIndex >= LOCAL_BASE) {
      if (d.property === L_WIGGLE_ANGLE) out.wiggleAngle = parseNumber(single(d), d.property);
      else if (!L_IGNORED.has(d.property)) unknown(d);
      continue;
    }
    switch (d.propertyIndex) {
      case P_FILL:
        out.fill = parseHex(single(d), d.property);
        break;
      case P_OPACITY:
        out.opacity = parseNumber(single(d), d.property);
        break;
      case P_MOTION_GROUP:
        // 06 §5.1 "first value" vs "count other than one is malformed": ruled count ≠ 1 → error.
        out.motionGroup = parseInteger(single(d), d.property);
        break;
      case P_VARIABLE_THRESHOLD:
        out.variableThreshold = parseNumber(single(d), d.property);
        break;
      case P_LAYER_TAGS:
        out.tags = [...d.values];
        break;
      case P_ALWAYS_ROTATES:
        out.alwaysRotates = bool(d);
        break;
      case P_DRAW_REVERSES:
        out.drawReversesMotionGroups = bool(d);
        break;
      case P_VALUE_MODE:
        out.variableValueMode = oneOf(d, ["color", "draw"] as const);
        break;
      case P_VC_CONTINUOUS:
        out.vcContinuous = bool(d);
        break;
      case P_ALWAYS_PULSES:
        out.alwaysPulses = bool(d);
        break;
      case P_CLEAR_BEHIND:
        out.clearBehind = bool(d);
        break;
      case P_FILL_ACTION:
        out.fillAction = oneOf(d, ["draw", "erase"] as const);
        break;
      case P_INDICES:
        // 06 §7 [INF]: a declared -sfsymbols-indices with no value is malformed.
        if (d.values.length === 0) throw new DecodeError(WHERE, `${d.property}: no values (06 §7)`);
        out.indices = d.values.map((v) => parseInteger(v, d.property));
        break;
      case P_VARIABLE_DRAW:
        // 04 §3.2, 06 §5.1: exactly two numbers, kept in order.
        if (d.values.length !== 2) {
          throw new DecodeError(WHERE, `${d.property}: ${d.values.length} values where exactly two are required (06 §5.1)`);
        }
        out.variableDraw = [parseNumber(d.values[0] as string, d.property), parseNumber(d.values[1] as string, d.property)];
        break;
      case P_ATTACHMENTS:
        out.attachments = parseAttachments(d.values, d.property);
        break;
      case P_WIGGLE_STYLE:
        out.wiggleStyle = oneOf(d, ["linear", "clockwise", "counterClockwise"] as const);
        break;
      case P_ROTATES_CLOCKWISE:
        out.rotatesClockwise = bool(d);
        break;
      default:
        unknown(d);
    }
  }
  return out;
}

/**
 * 04 §3.4, 06 §8: a property outside the 04 §4.1 census is an error naming it, so a new
 * build's vocabulary surfaces.
 */
function unknown(d: Declaration): never {
  throw new DecodeError(WHERE, `unknown property "${d.property}" (04 §4.1)`);
}
