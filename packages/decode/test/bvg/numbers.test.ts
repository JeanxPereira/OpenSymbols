import { describe, expect, it } from "vitest";
import { NibbleReader } from "../../src/bvg/nibbles.js";
import { decodeGenericValue, decodePackedPair } from "../../src/bvg/numbers.js";
import { DecodeError } from "../../src/errors.js";
import { nibbles } from "../helpers/nibbles.js";

const gv = (scale: number, ...ns: number[]) =>
  decodeGenericValue(new NibbleReader(nibbles(...ns)), scale);

describe("decodeGenericValue (Docs/format/03 §5)", () => {
  // §5.3 worked examples
  it("scale 0, [3] -> 3", () => expect(gv(0, 0x3)).toBe(3));
  it("scale 0, [B 0 5] -> 3.5", () => expect(gv(0, 0xb, 0x0, 0x5)).toBe(3.5));
  it("scale 1, [2 1 4] -> 20", () => expect(gv(1, 0x2, 0x1, 0x4)).toBe(20));

  it("runs dry mid-number -> null", () => {
    // n = B (fraction follows), f = 0, then g is missing.
    expect(decodeGenericValue(new NibbleReader(new Uint8Array([0xb0])), 0)).toBeNull();
    expect(decodeGenericValue(new NibbleReader(new Uint8Array([])), 0)).toBeNull();
  });

  it("consumes exactly its nibbles", () => {
    const r = new NibbleReader(nibbles(0xb, 0x0, 0x5, 0x3));
    expect(decodeGenericValue(r, 0)).toBe(3.5);
    expect(decodeGenericValue(r, 0)).toBe(3);
    expect(r.atEnd()).toBe(true);
  });

  it("scale != 0 keeps the 33rd integer bit exactly", () => {
    // n = 7: (7>>1)&3 = 3 -> integerWidths[3] = 32 bits -> readValue(8);
    // n&1 = 1 -> integer = 2^32 | 1; bit 3 of n clear -> no fraction.
    expect(gv(1, 0x7, 0, 0, 0, 0, 0, 0, 0, 1)).toBe(2 ** 32 + 1);
  });

  it("fraction kind 0: [9 0 7] -> 1.7", () => {
    // n = 9: integer 9&7 = 1, bit 3 set. f = 0: no exponent, kind 0.
    // g = 7: frac = 7, zeros 0 -> 1 + 7/10.
    expect(gv(0, 0x9, 0x0, 0x7)).toBe(1.7);
  });

  it("fraction kind 1: [A 1 1 0 0] -> 2 + 256/1000 (doc arithmetic, not 2.256)", () => {
    // n = A: integer 2, bit 3 set. f = 1: kind 1.
    // g = 1: w = halfNibbleDecimalWidths[(1>>2)&3 = 0] - 2 = 8 -> readValue(2) = 0x00;
    //   frac = 0x00 | ((1&3) << 8) = 256, zeros 0 -> 2 + 256/1000.
    // §5.1 is `value += frac / 10^k` in doubles, which is 2.2560000000000002, one ulp
    // above the double nearest 2.256. Pinned: this is the doc's rule, not decimal rounding.
    expect(gv(0, 0xa, 0x1, 0x1, 0x0, 0x0)).toBe(2 + 256 / 1000);
    expect(gv(0, 0xa, 0x1, 0x1, 0x0, 0x0)).toBe(2.2560000000000002);
  });

  it("fraction kind 1 with a zero high part: [A 1 0 1 9] -> 2.25", () => {
    // g = 0: w = 8 -> readValue(2) = 0x19 = 25; frac = 25 | (0 << 8) -> 2 + 25/100.
    expect(gv(0, 0xa, 0x1, 0x0, 0x1, 0x9)).toBe(2.25);
  });

  it("fraction kind 2: [8 2 4 0 7 B] -> 0.0123", () => {
    // n = 8: integer 0, bit 3 set. f = 2: kind 2.
    // g = 4: frac = readValue(decimalWidths[4&3 = 0] = 12 >> 2 = 3) = 0x07B = 123;
    //   zeros = (4>>2)&3 = 1 -> 123 / 10^(3+1).
    expect(gv(0, 0x8, 0x2, 0x4, 0x0, 0x7, 0xb)).toBe(0.0123);
  });

  it("fraction kind 2, the doc's 0.005258998 (frac 5258998, zeros 2)", () => {
    // g = A: decimalWidths[A&3 = 2] = 28 bits -> 7 nibbles; zeros = (A>>2)&3 = 2.
    // 5258998 = 0x503EF6 -> nibbles 0 5 0 3 E F 6. 5258998 / 10^(7+2).
    expect(gv(0, 0x8, 0x2, 0xa, 0x0, 0x5, 0x0, 0x3, 0xe, 0xf, 0x6)).toBe(0.005258998);
  });

  it("fraction kind 3: [C 3 1 0 0 5] -> 4.05", () => {
    // n = C: integer 4, bit 3 set. f = 3: kind 3. g = 1 -> zeros = 1.
    // h = 0: w = halfNibbleDecimalWidths[0] - 2 = 8 -> readValue(2) = 0x05; frac = 5 | (0 << 8).
    //   4 + 5 / 10^(1+1).
    expect(gv(0, 0xc, 0x3, 0x1, 0x0, 0x0, 0x5)).toBe(4.05);
  });

  it("exponent, no fraction, dividing: [D 4 6 0 3] -> 0.005", () => {
    // n = D: integer 5, bit 3 set. f = 4: bit 2 set -> applyExponent(5).
    // g = 6: bit 2 set; g&1 = 0 -> exponentWidths[0] = 8 bits -> readValue(2) = 3;
    //   bit 1 set -> divide: 5 / 10^3.
    expect(gv(0, 0xd, 0x4, 0x6, 0x0, 0x3)).toBe(0.005);
  });

  it("exponent, no fraction, multiplying: [B 4 4 0 2] -> 300", () => {
    // n = B: integer 3. f = 4 -> applyExponent. g = 4: bit 2 set, bit 1 clear -> multiply;
    //   g&1 = 0 -> 8 bits -> e = 2: 3 * 100.
    expect(gv(0, 0xb, 0x4, 0x4, 0x0, 0x2)).toBe(300);
  });

  it("exponent with 12-bit width: [B 4 5 0 0 1] -> 30", () => {
    // g = 5: bit 2 set, bit 1 clear -> multiply; g&1 = 1 -> exponentWidths[1] = 12 -> 3 nibbles = 1.
    expect(gv(0, 0xb, 0x4, 0x5, 0x0, 0x0, 0x1)).toBe(30);
  });

  it("an exponent whose power of ten overflows is a DecodeError (03 section 5.2)", () => {
    // e = 0xFFF = 4095: 10^4095 is not a finite double, multiplying or dividing.
    expect(() => gv(0, 0xb, 0x4, 0x5, 0xf, 0xf, 0xf)).toThrow(DecodeError);
    expect(() => gv(0, 0xb, 0x4, 0x7, 0xf, 0xf, 0xf)).toThrow(/10\^4095/);
  });

  it("a product that overflows is a DecodeError: [B 4 5 1 3 4] -> 3 * 10^308", () => {
    expect(() => gv(0, 0xb, 0x4, 0x5, 0x1, 0x3, 0x4)).toThrow(DecodeError);
  });

  it("exponent nibble with bit 2 clear leaves the value: [B 4 0] -> 3", () => {
    const r = new NibbleReader(nibbles(0xb, 0x4, 0x0, 0x3));
    expect(decodeGenericValue(r, 0)).toBe(3);
    expect(decodeGenericValue(r, 0)).toBe(3);
  });

  it("fraction then exponent: [9 8 5 6 0 1] -> 0.15", () => {
    // n = 9: integer 1. f = 8: bit 2 clear, kind 0, bit 3 set (exponent after fraction).
    // g = 5 -> 1.5. applyExponent: g = 6 -> divide, 8 bits, e = 1 -> 1.5 / 10.
    expect(gv(0, 0x9, 0x8, 0x5, 0x6, 0x0, 0x1)).toBe(0.15);
  });
});

describe("decodePackedPair (Docs/format/03 §5.4)", () => {
  it("scale 0, head 5: wa small (4), wb large (8): [5 A B] -> (3, 43)", () => {
    // raw = readValue((4+8)>>2 = 3) = 0x5AB = 1451.
    // b = raw & (2^7 - 1) = 43; a = (raw >> 7) & (2^3 - 1) = 11 & 7 = 3.
    const r = new NibbleReader(nibbles(0x5, 0xa, 0xb));
    expect(decodePackedPair(r, 0)).toEqual([3, 43]);
  });

  it("scale 0, head 3: both small (4): [3 7] -> (6, 7)", () => {
    // raw = 0x37 = 55; b = 55 & 7 = 7; a = (55 >> 3) & 7 = 6.
    const r = new NibbleReader(nibbles(0x3, 0x7));
    expect(decodePackedPair(r, 0)).toEqual([6, 7]);
  });

  it("scale is masked to two bits: scale 4 behaves as scale 0", () => {
    const r = new NibbleReader(nibbles(0x3, 0x7));
    expect(decodePackedPair(r, 4)).toEqual([6, 7]);
  });

  it("scale 1, head C: both large (10): 5 nibbles", () => {
    // raw = readValue(20 >> 2 = 5) = 0xC0201 ; b = raw & (2^9 - 1) = 0x001 = 1;
    // a = (raw >> 9) & (2^9 - 1) = 0x601 & 0x1FF = 1. (0xC0201 >> 9 = 0x601.)
    const r = new NibbleReader(nibbles(0xc, 0x0, 0x2, 0x0, 0x1));
    expect(decodePackedPair(r, 1)).toEqual([1, 1]);
  });

  it("runs dry -> null", () => {
    expect(decodePackedPair(new NibbleReader(nibbles(0x5, 0xa)), 0)).toBeNull();
    expect(decodePackedPair(new NibbleReader(new Uint8Array([])), 0)).toBeNull();
  });
});
