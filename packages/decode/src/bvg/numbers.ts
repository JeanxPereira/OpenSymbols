import { DecodeError } from "../errors.js";
import type { NibbleReader } from "./nibbles.js";

const WHERE = "BVG number";

// Docs/format/03 §2: constant tables of CoreUI 26A5416b. All widths are in bits; a width
// `w` is read as `readValue(w >> 2)` nibbles.
const integerWidths = [4, 8, 12, 32] as const;
const halfNibbleDecimalWidths = [10, 14, 26, 38] as const;
const decimalWidths = [12, 16, 28, 40] as const;
const exponentWidths = [8, 12] as const;
const kIntegerSmallBits = [4, 6, 8, 10] as const;
const kIntegerLargeBits = [8, 10, 12, 14] as const;

// Docs/format/03 §2 `kPowersOf10`: 1e0 … 1e20, all exact doubles.
const kPowersOf10 = Array.from({ length: 21 }, (_, k) => Number(`1e${k}`));

/**
 * 10^k: from `kPowersOf10` when k ≤ 20 (Docs/format/03 §5.1, §5.2), else correctly rounded.
 * Docs/format/03 §5.2 [INF]: a power that is not a finite double is malformed.
 */
function pow10(k: number): number {
  const p = k <= 20 ? kPowersOf10[k]! : Number(`1e${k}`);
  if (!Number.isFinite(p)) throw new DecodeError(WHERE, `exponent 10^${k} overflows a double (03 §5.2)`);
  return p;
}

/** Decimal digit count of a non-negative integer (Docs/format/03 §5.1 `digits`). */
function digits(n: number): number {
  return String(n).length;
}

/** Docs/format/03 §5.2 `applyExponent`. */
function applyExponent(r: NibbleReader, value: number): number | null {
  const g = r.nibble();
  if (g === null) return null;
  if (((g >> 2) & 1) === 0) return value;
  const e = r.value(exponentWidths[g & 1]! >> 2);
  if (e === null) return null;
  const p = pow10(e);
  const out = (g >> 1) & 1 ? value / p : value * p;
  // Docs/format/03 §5.2 [INF]: a scaled value that overflows is malformed, not Infinity.
  if (!Number.isFinite(out)) {
    throw new DecodeError(WHERE, `${value} × 10^${(g >> 1) & 1 ? -e : e} overflows a double (03 §5.2)`);
  }
  return out;
}

/** Docs/format/03 §5.1 kinds 1 and 3: `frac = readValue(w >> 2) | ((sel & 3) << w)`. */
function halfNibbleFraction(r: NibbleReader, sel: number): number | null {
  const w = halfNibbleDecimalWidths[(sel >> 2) & 3]! - 2;
  const low = r.value(w >> 2);
  if (low === null) return null;
  // w reaches 36: exact arithmetic, not a 32-bit shift (Docs/format/03 §5.1 [INF]).
  return (sel & 3) * 2 ** w + low;
}

/**
 * Docs/format/03 §5.1 `decodeGenericValue`: one non-negative number at the current
 * `scale`. `null` if the stream runs dry inside it.
 */
export function decodeGenericValue(r: NibbleReader, scale: number): number | null {
  const n = r.nibble();
  if (n === null) return null;

  let integer: number;
  if (scale === 0) {
    integer = n & 7;
  } else {
    const bits = integerWidths[(n >> 1) & 3]!;
    const low = r.value(bits >> 2);
    if (low === null) return null;
    // `(n & 1) << bits` with bits = 32 reaches 33 bits: exact arithmetic.
    integer = (n & 1) * 2 ** bits + low;
  }
  let value = integer;
  if (((n >> 3) & 1) === 0) return value; // no fraction, no exponent

  const f = r.nibble();
  if (f === null) return null;
  if ((f >> 2) & 1) return applyExponent(r, value); // exponent, no fraction

  const g = r.nibble();
  if (g === null) return null;
  let frac: number | null;
  let zeros: number;
  switch (f & 3) {
    case 0:
      frac = g;
      zeros = 0;
      break;
    case 1:
      frac = halfNibbleFraction(r, g);
      zeros = 0;
      break;
    case 2:
      frac = r.value(decimalWidths[g & 3]! >> 2);
      zeros = (g >> 2) & 3;
      break;
    default: {
      const h = r.nibble();
      if (h === null) return null;
      frac = halfNibbleFraction(r, h);
      zeros = g;
      break;
    }
  }
  if (frac === null) return null;

  if (frac !== 0) value += frac / pow10(digits(frac) + zeros);
  if ((f >> 3) & 1) return applyExponent(r, value);
  return value;
}

/**
 * Docs/format/03 §5.4 packed pair: two non-negative integers sharing one field. The head
 * nibble is peeked, not consumed separately; its selector bits are part of the field.
 */
export function decodePackedPair(r: NibbleReader, scale: number): [number, number] | null {
  // Docs/format/03 §5.4 [INF]: scale arrives as a raw nibble; masked to two bits.
  const s = scale & 3;
  const head = r.peekNibble();
  if (head === null) return null;
  const wa = head & 8 ? kIntegerLargeBits[s]! : kIntegerSmallBits[s]!;
  const wb = head & 4 ? kIntegerLargeBits[s]! : kIntegerSmallBits[s]!;
  // wa + wb ≤ 28 bits: 32-bit bitwise arithmetic is exact here.
  const raw = r.value((wa + wb) >> 2);
  if (raw === null) return null;
  const b = raw & ((1 << (wb - 1)) - 1);
  const a = (raw >> (wb - 1)) & ((1 << (wa - 1)) - 1);
  return [a, b];
}

// Docs/format/03 §2 `signTable`.
const signTable = [1, -1] as const;

/** Result of `decodeRuns`: `dry` is true if the stream ran dry inside the runs. */
export interface RunsResult {
  values: number[];
  dry: boolean;
}

/**
 * Docs/format/03 §3.5: the run machine shared by paths and numeric lists (§4). `firstFlags` is
 * the first flag byte, already read; `sets` the number of flag-byte runs.
 */
export function decodeRuns(
  r: NibbleReader,
  firstFlags: number,
  firstScale: number,
  sets: number,
  packed: boolean,
): RunsResult {
  const values: number[] = [];
  let flags = firstFlags;
  let scale = firstScale;
  let remaining = sets;
  for (;;) {
    // Docs/format/03 §3.4 flag bit 2: read one nibble and make it the new scale.
    if (flags & 0x04) {
      const s = r.nibble();
      if (s === null) return { values, dry: true };
      scale = s;
    }
    // Docs/format/03 §3.4 flag bit 3: count is immediate; bits 4–7 its value or nibble width.
    const pairs = flags & 0x08 ? (flags >> 4) + 1 : r.value(flags >> 4);
    if (pairs === null) return { values, dry: true };
    remaining -= 1;
    // Docs/format/03 §3.4 bits 1 / 0: signs of the first / second value of each pair.
    const signA = signTable[(flags >> 1) & 1]!;
    const signB = signTable[flags & 1]!;
    for (let i = 0; i < pairs && !r.atEnd(); i++) {
      let a: number | null;
      let b: number | null;
      if (packed) {
        const pair = decodePackedPair(r, scale);
        if (pair === null) return { values, dry: true };
        [a, b] = pair;
      } else {
        a = decodeGenericValue(r, scale);
        if (a === null) return { values, dry: true };
        b = decodeGenericValue(r, scale);
        // An incomplete pair is not appended: values are appended in pairs (§3.5).
        if (b === null) return { values, dry: true };
      }
      // Docs/format/03 §3.5 "No -0": a zero is never multiplied by the sign.
      values.push(a === 0 ? 0 : a * signA, b === 0 ? 0 : b * signB);
    }
    if (remaining <= 0 || r.atEnd()) return { values, dry: false };
    const next = r.byte();
    if (next === null) return { values, dry: true };
    flags = next;
  }
}
