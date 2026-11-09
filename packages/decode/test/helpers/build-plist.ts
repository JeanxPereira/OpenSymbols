// Minimal bplist00 writer for tests (Docs/format/05 §1.1). Two-byte offsets and one-byte refs, so
// fixtures hold fewer than 256 objects.
export type Plist = string | number | boolean | Plist[] | { [k: string]: Plist };

function sizeHeader(type: number, count: number): number[] {
  if (count < 15) return [(type << 4) | count];
  return [(type << 4) | 0xf, 0x10, count]; // count < 256
}

export function buildBplist(root: Plist): Uint8Array {
  const objects: number[][] = [];
  const add = (v: Plist): number => {
    const index = objects.length;
    objects.push([]);
    let bytes: number[];
    if (typeof v === "boolean") {
      bytes = [v ? 0x09 : 0x08];
    } else if (typeof v === "number") {
      bytes = v < 256 ? [0x10, v] : [0x11, v >> 8, v & 0xff];
    } else if (typeof v === "string") {
      if (/^[\x00-\x7f]*$/.test(v)) {
        bytes = [...sizeHeader(0x5, v.length), ...[...v].map((c) => c.charCodeAt(0))];
      } else {
        const units: number[] = [];
        for (let i = 0; i < v.length; i++) {
          const u = v.charCodeAt(i);
          units.push(u >> 8, u & 0xff);
        }
        bytes = [...sizeHeader(0x6, v.length), ...units];
      }
    } else if (Array.isArray(v)) {
      const refs = v.map(add);
      bytes = [...sizeHeader(0xa, refs.length), ...refs];
    } else {
      const keys = Object.keys(v);
      const keyRefs = keys.map(add);
      const valueRefs = keys.map((k) => add(v[k] as Plist));
      bytes = [...sizeHeader(0xd, keys.length), ...keyRefs, ...valueRefs];
    }
    objects[index] = bytes;
    return index;
  };
  add(root);

  const out: number[] = [...Buffer.from("bplist00", "ascii")];
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(out.length);
    out.push(...o);
  }
  const tableOffset = out.length;
  for (const o of offsets) out.push(o >> 8, o & 0xff);
  out.push(0, 0, 0, 0, 0, 0); // unused[5], sortVersion
  out.push(2, 1); // offsetIntSize, objectRefSize
  const u64 = (n: number): number[] => [0, 0, 0, 0, (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  out.push(...u64(objects.length), ...u64(0), ...u64(tableOffset));
  return Uint8Array.from(out);
}
