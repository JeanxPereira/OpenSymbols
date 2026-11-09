// Test writer for the style block, written from Docs/format/04-style-block.md §1.1,
// independently of src/bvg/style.ts. Little-endian; Index/Offset widths as the document's.
//
//   Index classCount; ClassRecord[] { u8 kind, u8 layer, Index value, Offset ruleOffset };
//   rules packed: { u8 declCount, { Index property, u8 valueCount, Index value[] }[] }
//
// Rule offsets are relative to the start of the block. Values are RAW string indices
// (atom number, or 89 + i for local string i).

export interface StyleClassSpec {
  kind: number;
  layer: number;
  value: number;
  /** Index into `rules`; the builder resolves it to the rule's offset. */
  rule?: number;
  /** Raw ruleOffset, overriding `rule` (to build malformed blocks). */
  ruleOffset?: number;
}

export interface StyleDeclSpec {
  property: number;
  values: number[];
}

export interface BuildStyleOptions {
  indexWidth: 1 | 2 | 4;
  offsetWidth: 1 | 2 | 4;
  classes: StyleClassSpec[];
  rules: StyleDeclSpec[][];
}

function put(out: number[], width: number, value: number): void {
  for (let i = 0; i < width; i++) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
}

function ruleSize(rule: StyleDeclSpec[], iw: number): number {
  return 1 + rule.reduce((s, d) => s + iw + 1 + d.values.length * iw, 0);
}

/** Offset of rule `i` within a block built from these options. */
export function ruleOffsetOf(opts: BuildStyleOptions, i: number): number {
  const iw = opts.indexWidth;
  let cursor = iw + opts.classes.length * (2 + iw + opts.offsetWidth);
  for (let r = 0; r < i; r++) cursor += ruleSize(opts.rules[r] as StyleDeclSpec[], iw);
  return cursor;
}

export function buildStyle(opts: BuildStyleOptions): number[] {
  const { indexWidth: iw, offsetWidth: ow } = opts;
  const out: number[] = [];
  put(out, iw, opts.classes.length);
  for (const c of opts.classes) {
    out.push(c.kind, c.layer);
    put(out, iw, c.value);
    put(out, ow, c.ruleOffset ?? ruleOffsetOf(opts, c.rule ?? 0));
  }
  for (const rule of opts.rules) {
    out.push(rule.length);
    for (const d of rule) {
      put(out, iw, d.property);
      out.push(d.values.length);
      for (const v of d.values) put(out, iw, v);
    }
  }
  return out;
}
