/** Pack a nibble sequence into bytes, high nibble first; an odd count is padded with 0. */
export function nibbles(...ns: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(ns.length / 2));
  ns.forEach((n, i) => {
    out[i >> 1]! |= (i & 1) === 0 ? n << 4 : n;
  });
  return out;
}

/** Path header of Docs/format/03 §3.1 (0x00, value count 0, command count 1) as nibbles. */
export const PATH_HEADER = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1] as const;
