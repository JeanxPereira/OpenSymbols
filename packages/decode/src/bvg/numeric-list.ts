import { DecodeError } from "../errors.js";
import { NibbleReader } from "./nibbles.js";
import { decodeRuns } from "./numbers.js";

/**
 * Docs/format/03 §4: decode a `BVG ` numeric list (`viewBox`, `data-clipstroke-keyframes`).
 * The §3.5 run machine without command bytes. Running dry ends the list with what has been
 * decoded (§1.4).
 */
export function decodeNumericList(blob: Uint8Array): number[] {
  const r = new NibbleReader(blob);

  // Docs/format/03 §4: u8 0x00, must be zero.
  const first = r.byte();
  if (first === null) throw new DecodeError("BVG numeric list", "empty numeric list stream");
  if (first !== 0) {
    throw new DecodeError(
      "BVG numeric list",
      `first byte is 0x${first.toString(16).padStart(2, "0")}, expected 0x00`,
    );
  }

  // Docs/format/03 §4 header: bit 7 packed, bit 6 immediate count in bits 0–4, bit 5 odd
  // length (drop last), bits 0–1 nibble width of the count when bit 6 is clear.
  // [INF] A stream ending right after (or before) the header is an empty list.
  const header = r.byte();
  if (header === null) return [];
  const packed = (header & 0x80) !== 0;
  const dropLast = (header & 0x20) !== 0;
  const count = header & 0x40 ? header & 0x1f : r.value(header & 3);
  // Docs/format/03 §4 [INF]: a count of 0 describes no runs; the list is empty.
  if (count === null || count === 0) return [];

  const flags = r.byte();
  if (flags === null) return [];

  // Docs/format/03 §4: runs exactly as in §3.5, scale = 0 at the start and sets = count.
  const { values } = decodeRuns(r, flags, 0, count, packed);
  if (dropLast && values.length > 0) values.pop();
  return values;
}
