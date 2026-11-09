// Test writer for `BVG ` documents, written from Docs/format/02-bvg-document.md
// (§1 header, §2 string pool, §4 node area), independently of src/bvg/document.ts.
// All fields are little-endian; Index/Offset widths come from the type code (§1.3).
//
// Values are RAW indices: a local string i is referenced as 89 + i (§2.2), an atom by
// its number (§3). Path / list attribute values are local strings holding raw blobs
// (Uint8Array); hand-encoded blobs used by tests (Docs/format/03):
//   PATH_Z       [00 00 00 00 01 70]  decodes to a single Z command
//   LIST_0_0_3_5 [00 41 10 20 03 50]  decodes to [0, 0, 3, 5]

export const PATH_Z = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x01, 0x70]);
export const LIST_0_0_3_5 = new Uint8Array([0x00, 0x41, 0x10, 0x20, 0x03, 0x50]);

export interface NodeSpec {
  tag: number;
  /** The record's own idIndex field (§4.3; readers skip it). */
  idIndex?: number;
  attrs?: Array<{ name: number; value: number }>;
  classes?: number[];
  children?: NodeSpec[];
}

export interface BuildBvgOptions {
  typeCode: number;
  version?: number;
  localStrings?: Array<string | Uint8Array>;
  /** Id table; `target` is resolved to that node's offset in the node area. */
  idPairs?: Array<{ stringIndex: number; target?: NodeSpec; nodeOffset?: number }>;
  root: NodeSpec;
  /** Raw style-block bytes (default empty), placed between the pool and the node area. */
  style?: number[];
}

function put(out: number[], width: number, value: number): void {
  for (let i = 0; i < width; i++) out.push(Math.floor(value / 2 ** (8 * i)) % 256);
}

export function buildBvg(opts: BuildBvgOptions): Uint8Array {
  const iw = opts.typeCode >> 4;
  const ow = opts.typeCode & 0xf;
  const strings = (opts.localStrings ?? []).map((s) =>
    typeof s === "string" ? new TextEncoder().encode(s) : s,
  );
  const pairs = opts.idPairs ?? [];
  const style = opts.style ?? [];

  // Node area: id table, then records laid out in pre-order; offsets relative to its start.
  const nodeSize = (n: NodeSpec) =>
    2 * iw +
    3 +
    (n.attrs?.length ?? 0) * 2 * iw +
    (n.classes?.length ?? 0) * iw +
    (n.children?.length ?? 0) * ow;
  const offsets = new Map<NodeSpec, number>();
  let cursor = iw + pairs.length * (iw + ow);
  const assign = (n: NodeSpec) => {
    offsets.set(n, cursor);
    cursor += nodeSize(n);
    for (const c of n.children ?? []) assign(c);
  };
  assign(opts.root);

  const area: number[] = [];
  put(area, iw, pairs.length);
  for (const p of pairs) {
    put(area, iw, p.stringIndex);
    put(area, ow, p.target ? (offsets.get(p.target) as number) : (p.nodeOffset as number));
  }
  const emit = (n: NodeSpec) => {
    put(area, iw, n.tag);
    put(area, iw, n.idIndex ?? 0);
    area.push(n.attrs?.length ?? 0, n.classes?.length ?? 0, n.children?.length ?? 0);
    for (const a of n.attrs ?? []) {
      put(area, iw, a.name);
      put(area, iw, a.value);
    }
    for (const c of n.classes ?? []) put(area, iw, c);
    for (const c of n.children ?? []) put(area, ow, offsets.get(c) as number);
    for (const c of n.children ?? []) emit(c);
  };
  emit(opts.root);

  // Header (§1.1) + offset table with sentinel, then string bytes, style, node area.
  const headerSize = 4 + 1 + 1 + 2 * ow + iw + (strings.length + 1) * ow;
  const poolSize = strings.reduce((s, b) => s + b.length, 0);
  const styleOffset = headerSize + poolSize;
  const nodeOffset = styleOffset + style.length;

  const out: number[] = [0x42, 0x56, 0x47, 0x20, opts.version ?? 1, opts.typeCode];
  put(out, ow, nodeOffset);
  put(out, ow, styleOffset);
  put(out, iw, strings.length);
  let at = headerSize;
  for (const s of strings) {
    put(out, ow, at);
    at += s.length;
  }
  put(out, ow, styleOffset); // sentinel == styleOffset (§2.1)
  for (const s of strings) for (const b of s) out.push(b);
  for (const b of style) out.push(b);
  for (const b of area) out.push(b);
  return Uint8Array.from(out);
}
