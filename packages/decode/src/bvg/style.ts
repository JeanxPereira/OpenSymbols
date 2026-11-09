import { ByteReader } from "../bytes.js";
import { DecodeError } from "../errors.js";
import type { BvgDocument } from "./document.js";

const WHERE = "BVG style block";

/** Docs/format/04 §2.2: the four family prefixes, indexed by `kind & 0x7f`. */
const PREFIXES = [".monochrome-", ".multicolor-", ".hierarchical-", ".shapeGroupLayer-"] as const;
const FAMILY_KINDS = ["monochrome", "multicolor", "hierarchical", "shapeGroupLayer"] as const;
/** Docs/format/04 §2.1: "no value" sentinel, compared as the number 255 at every width. */
const NO_VALUE = 0xff;

export type ClassKind = "named" | (typeof FAMILY_KINDS)[number];

export interface StyleClass {
  kind: ClassKind;
  layer: number;
  /** e.g. ".multicolor-0:tintColor" (04 §2.1) */
  name: string;
  value?: string;
  /** Index into `StyleBlock.rules`. */
  ruleIndex: number;
}

export interface Declaration {
  property: string;
  propertyIndex: number;
  /** Every value as stored, one string each (04 §3.1); never split or joined. */
  values: string[];
}

export interface StyleBlock {
  classes: StyleClass[];
  /** Rules in offset order (04 §1.1). */
  rules: Declaration[][];
  /** Indices into `rules` that no class points at (04 §1.2: reported, not an error). */
  orphanRules: number[];
}

export function parseStyleBlock(doc: BvgDocument): StyleBlock {
  const { indexWidth, offsetWidth } = doc;
  const r = new ByteReader(doc.styleBytes);
  const idx = () => r.uint(indexWidth, "le");

  // §1.1 class records
  const classCount = idx();
  if (classCount * (2 + indexWidth + offsetWidth) > r.remaining()) {
    throw new DecodeError(WHERE, `classCount ${classCount} does not fit in the block (04 §1.1)`);
  }
  const raw: Array<{ kindByte: number; layer: number; value: number; ruleOffset: number }> = [];
  for (let i = 0; i < classCount; i++) {
    const kindByte = r.u8();
    const layer = r.u8();
    const value = idx();
    const ruleOffset = r.uint(offsetWidth, "le");
    raw.push({ kindByte, layer, value, ruleOffset });
  }

  // §1.1 rules: packed to the end of the block. Record each rule's start offset.
  const rules: Declaration[][] = [];
  const ruleIndexByOffset = new Map<number, number>();
  while (r.remaining() > 0) {
    ruleIndexByOffset.set(r.pos, rules.length);
    const declCount = r.u8();
    const decls: Declaration[] = [];
    for (let d = 0; d < declCount; d++) {
      const propertyIndex = idx();
      const valueCount = r.u8();
      const values: string[] = [];
      for (let v = 0; v < valueCount; v++) values.push(doc.stringAt(idx()));
      decls.push({ property: doc.stringAt(propertyIndex), propertyIndex, values });
    }
    rules.push(decls);
  }

  // §2.1 naming; §1.2 ruleOffset must be a rule start.
  const referenced = new Set<number>();
  const classes = raw.map((c, i): StyleClass => {
    const ruleIndex = ruleIndexByOffset.get(c.ruleOffset);
    if (ruleIndex === undefined) {
      throw new DecodeError(WHERE, `class ${i}: ruleOffset ${c.ruleOffset} is not a rule start (04 §1.2)`);
    }
    referenced.add(ruleIndex);
    if ((c.kindByte & 0x80) === 0) {
      if (c.kindByte !== 0) {
        throw new DecodeError(WHERE, `class ${i}: kind ${c.kindByte} is not a defined kind (04 §2.1)`);
      }
      const value = doc.stringAt(c.value);
      return { kind: "named", layer: c.layer, name: value, value, ruleIndex };
    }
    const family = c.kindByte & 0x7f;
    if (family >= PREFIXES.length) {
      throw new DecodeError(WHERE, `class ${i}: family kind ${family} is not defined (04 §2.1)`);
    }
    const out: StyleClass = {
      kind: FAMILY_KINDS[family] as ClassKind,
      layer: c.layer,
      name: `${PREFIXES[family]}${c.layer}`,
      ruleIndex,
    };
    if (c.value !== NO_VALUE) {
      out.value = doc.stringAt(c.value);
      out.name += `:${out.value}`;
    }
    return out;
  });

  const orphanRules: number[] = [];
  for (let i = 0; i < rules.length; i++) if (!referenced.has(i)) orphanRules.push(i);
  return { classes, rules, orphanRules };
}
