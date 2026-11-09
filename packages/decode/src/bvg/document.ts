import { ByteReader } from "../bytes.js";
import { DecodeError } from "../errors.js";
import {
  ATTR_CLIPSTROKE_KEYFRAMES,
  ATTR_D,
  ATTR_VIEWBOX,
  LOCAL_BASE,
  PREDEFINED,
} from "./atoms.js";
import { decodeNumericList } from "./numeric-list.js";
import { decodePath, type PathCommand } from "./path.js";

export { LOCAL_BASE, PREDEFINED } from "./atoms.js";

const WHERE = "BVG ";
/** Docs/format/02 §4.3: depth is bounded; 64 is ample. */
const MAX_DEPTH = 64;

export type AttrValue =
  | { kind: "path"; commands: PathCommand[] }
  | { kind: "list"; values: number[] }
  | { kind: "string"; text: string };

export interface BvgNode {
  tag: string;
  tagIndex: number;
  id?: string;
  attrs: Array<{ name: string; nameIndex: number; value: AttrValue }>;
  /** Raw indices into the style block's class list (04 §1), NOT string-pool indices. */
  classIndices: number[];
  children: BvgNode[];
}

export interface BvgDocument {
  version: number;
  indexWidth: 1 | 2 | 4;
  offsetWidth: 1 | 2 | 4;
  /** Local strings only: [0] is string index 89. */
  strings: string[];
  stringAt(index: number): string;
  root: BvgNode;
  /** Bytes of [styleOffset, nodeOffset), parsed by the style-block reader. */
  styleBytes: Uint8Array;
}

function width(n: number, what: string): 1 | 2 | 4 {
  if (n === 1 || n === 2 || n === 4) return n;
  throw new DecodeError(WHERE, `${what} ${n} is not 1, 2 or 4 (02 §1.3)`);
}

export function parseBvg(bytes: Uint8Array): BvgDocument {
  const r = new ByteReader(bytes);
  // §1.1 header
  if (r.ascii(4) !== "BVG ") throw new DecodeError(WHERE, "bad magic");
  const version = r.u8();
  if (version !== 1) throw new DecodeError(WHERE, `unsupported version ${version} (02 §1.2)`);
  const typeCode = r.u8();
  // §1.3: widths from the type code; every later field uses them.
  const indexWidth = width(typeCode >> 4, "index width");
  const offsetWidth = width(typeCode & 0xf, "offset width");
  const idx = () => r.uint(indexWidth, "le");
  const off = () => r.uint(offsetWidth, "le");

  const nodeOffset = off();
  const styleOffset = off();
  // §1.4: the style block precedes the node area.
  if (styleOffset > nodeOffset) {
    throw new DecodeError(WHERE, `styleOffset ${styleOffset} > nodeOffset ${nodeOffset} (02 §1.4)`);
  }
  if (nodeOffset > bytes.length) {
    throw new DecodeError(WHERE, `nodeOffset ${nodeOffset} is past the end (${bytes.length})`);
  }

  // §2.1 string pool; validate the table before sizing anything from the count.
  const stringCount = idx();
  if ((stringCount + 1) * offsetWidth > r.remaining()) {
    throw new DecodeError(WHERE, `stringCount ${stringCount} does not fit in the document`);
  }
  const offsets: number[] = [];
  for (let i = 0; i <= stringCount; i++) offsets.push(off());
  for (let i = 1; i < offsets.length; i++) {
    if ((offsets[i] as number) < (offsets[i - 1] as number)) {
      throw new DecodeError(WHERE, `string offsets decrease at ${i} (02 §2.1)`);
    }
  }
  const sentinel = offsets[stringCount] as number;
  if (sentinel > bytes.length) {
    throw new DecodeError(WHERE, `string sentinel ${sentinel} is past the end (${bytes.length})`);
  }
  if (sentinel !== styleOffset) {
    throw new DecodeError(WHERE, `string sentinel ${sentinel} != styleOffset ${styleOffset} (02 §2.1)`);
  }
  const blobs: Uint8Array[] = [];
  const decoder = new TextDecoder("utf-8");
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const blob = bytes.slice(offsets[i] as number, offsets[i + 1] as number);
    blobs.push(blob);
    strings.push(decoder.decode(blob));
  }

  const stringAt = (index: number): string => {
    if (Number.isInteger(index) && index >= 0) {
      if (index < LOCAL_BASE) return PREDEFINED[index] as string;
      const local = strings[index - LOCAL_BASE];
      if (local !== undefined) return local;
    }
    throw new DecodeError(WHERE, `string index ${index} names nothing (02 §2.2)`);
  };

  // §5.1: a path/list value is a blob only when it names a local string.
  const readValue = (nameIndex: number, valueIndex: number): AttrValue => {
    const blob = valueIndex >= LOCAL_BASE ? blobs[valueIndex - LOCAL_BASE] : undefined;
    if (blob !== undefined) {
      if (nameIndex === ATTR_D) return { kind: "path", commands: decodePath(blob) };
      if (nameIndex === ATTR_VIEWBOX || nameIndex === ATTR_CLIPSTROKE_KEYFRAMES) {
        return { kind: "list", values: decodeNumericList(blob) };
      }
    }
    return { kind: "string", text: stringAt(valueIndex) };
  };

  // §4 node area: id table, then the root record.
  const area = new ByteReader(bytes, nodeOffset);
  const pairCount = area.uint(indexWidth, "le");
  if (pairCount * (indexWidth + offsetWidth) > area.remaining()) {
    throw new DecodeError(WHERE, `pairCount ${pairCount} does not fit in the node area`);
  }
  const ids = new Map<number, string>();
  for (let i = 0; i < pairCount; i++) {
    const stringIndex = area.uint(indexWidth, "le");
    const rel = area.uint(offsetWidth, "le");
    ids.set(rel, stringAt(stringIndex));
  }
  const rootRel = indexWidth + pairCount * (indexWidth + offsetWidth);

  let visited = 0;
  const readNode = (rel: number, parentRel: number, depth: number): BvgNode => {
    if (depth > MAX_DEPTH) throw new DecodeError(WHERE, `node depth exceeds ${MAX_DEPTH}`);
    if (rel <= parentRel) {
      throw new DecodeError(WHERE, `child offset ${rel} does not advance past ${parentRel} (02 §4.3)`);
    }
    if (++visited > bytes.length) throw new DecodeError(WHERE, "node count exceeds document size");
    const nr = new ByteReader(bytes, nodeOffset + rel);
    const tagIndex = nr.uint(indexWidth, "le");
    nr.uint(indexWidth, "le"); // idIndex: skipped, ids come from the id table (§4.3)
    const attrCount = nr.u8();
    const classCount = nr.u8();
    const childCount = nr.u8();
    const attrs: BvgNode["attrs"] = [];
    for (let i = 0; i < attrCount; i++) {
      const nameIndex = nr.uint(indexWidth, "le");
      const valueIndex = nr.uint(indexWidth, "le");
      attrs.push({ name: stringAt(nameIndex), nameIndex, value: readValue(nameIndex, valueIndex) });
    }
    const classIndices: number[] = [];
    for (let i = 0; i < classCount; i++) classIndices.push(nr.uint(indexWidth, "le"));
    const childOffsets: number[] = [];
    for (let i = 0; i < childCount; i++) childOffsets.push(nr.uint(offsetWidth, "le"));
    const node: BvgNode = { tag: stringAt(tagIndex), tagIndex, attrs, classIndices, children: [] };
    const id = ids.get(rel);
    if (id !== undefined) node.id = id;
    for (const c of childOffsets) node.children.push(readNode(c, rel, depth + 1));
    return node;
  };
  const root = readNode(rootRel, -1, 0);

  return {
    version,
    indexWidth,
    offsetWidth,
    strings,
    stringAt,
    root,
    styleBytes: bytes.slice(styleOffset, nodeOffset),
  };
}
