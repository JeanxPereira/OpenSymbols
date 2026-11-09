/**
 * The `BVG ` nibble reader (Docs/format/03 §1). Every read returns `null` when the stream
 * runs dry; running dry is not an error (Docs/format/03 §1.4), so nothing here throws.
 */
export class NibbleReader {
  private pos = 0;
  /** True when the high nibble of `bytes[pos]` has been consumed. */
  private half = false;

  constructor(private readonly bytes: Uint8Array) {}

  /** Docs/format/03 §1.1: high nibble first; `pos` advances only after the low nibble. */
  nibble(): number | null {
    const v = this.peekNibble();
    if (v === null) return null;
    if (this.half) this.pos += 1;
    this.half = !this.half;
    return v;
  }

  /** Docs/format/03 §1.1: the next nibble, without moving. */
  peekNibble(): number | null {
    const b = this.bytes[this.pos];
    if (b === undefined) return null;
    return this.half ? b & 0xf : b >> 4;
  }

  /**
   * Docs/format/03 §1.2: aligned, the whole byte; mid-byte, the low nibble of `bytes[pos]`
   * spliced with the high nibble of `bytes[pos+1]` (`half` stays true). Runs dry if a
   * mid-byte read has only one nibble left.
   */
  byte(): number | null {
    const b = this.bytes[this.pos];
    if (b === undefined) return null;
    if (!this.half) {
      this.pos += 1;
      return b;
    }
    const next = this.bytes[this.pos + 1];
    if (next === undefined) return null;
    this.pos += 1;
    return ((b & 0xf) << 4) | (next >> 4);
  }

  /**
   * Docs/format/03 §1.3 `read_value`: `n` big-endian nibbles. Widths reach 10 nibbles
   * (40 bits), so accumulate with multiplication, not 32-bit shifts.
   */
  value(nibbles: number): number | null {
    if (nibbles === 0) return 0;
    if (nibbles === 1) return this.nibble();
    if (nibbles === 2) return this.byte();
    let v = 0;
    for (let i = 0; i < nibbles; i++) {
      const n = this.nibble();
      if (n === null) return null;
      v = v * 16 + n;
    }
    return v;
  }

  /** Docs/format/03 §1.2: at end when `pos >= length`; one nibble left is not at end. */
  atEnd(): boolean {
    return this.pos >= this.bytes.length;
  }
}
