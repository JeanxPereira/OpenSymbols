import { describe, expect, it } from "vitest";
import { DecodeError } from "../../src/errors.js";
import { decodeNumericList } from "../../src/bvg/numeric-list.js";

const list = (...bytes: number[]) => decodeNumericList(new Uint8Array(bytes));

describe("decodeNumericList (Docs/format/03 §4)", () => {
  it("header bit 6, count 0 -> []", () => {
    expect(list(0x00, 0x40, 0x00)).toEqual([]);
  });

  it("header bit 6 clear, width 0 -> count readValue(0) = 0 -> []", () => {
    expect(list(0x00, 0x00, 0x08, 0x35)).toEqual([]);
  });

  it("a first byte other than 0 throws", () => {
    expect(() => list(0x01, 0x41, 0x08, 0x35)).toThrow(DecodeError);
  });

  it("stream ends right after the header -> []", () => {
    expect(list(0x00, 0x41)).toEqual([]);
  });

  it("immediate count 1, counted pairs: [00 41 10 20 03 50] -> [0, 0, 3, 5]", () => {
    // header 41: bit 6 -> count = 1. flags 10: bit 3 clear -> pairs = readValue(1) = 2.
    // values 0 0 3 5; then sets = 0 -> stop (the trailing pad nibble is never read).
    expect(list(0x00, 0x41, 0x10, 0x20, 0x03, 0x50)).toEqual([0, 0, 3, 5]);
  });

  it("two runs, the first empty: [00 42 00 08 35] -> [3, 5]", () => {
    // count 2. flags 00: pairs = readValue(0) = 0. flags 08: 1 pair -> 3 5.
    expect(list(0x00, 0x42, 0x00, 0x08, 0x35)).toEqual([3, 5]);
  });

  it("counted count width and odd length: [00 21 | 1 0 8 3 4] -> [3]", () => {
    // header 21: bit 5 (drop last), bit 6 clear -> count = readValue(1) = 1.
    // first flag byte read mid-byte: 0x08 -> 1 pair: 3 4 -> drop last -> [3].
    expect(list(0x00, 0x21, 0x10, 0x83, 0x40)).toEqual([3]);
  });

  it("packed pairs (header bit 7): [00 C1 08 37] -> [6, 7]", () => {
    // header C1: bit 7 packed, bit 6 count 1. flags 08: 1 pair, scale 0.
    // packed 3 7: raw 0x37 -> b = 55 & 7 = 7, a = (55 >> 3) & 7 = 6.
    expect(list(0x00, 0xc1, 0x08, 0x37)).toEqual([6, 7]);
  });

  it("flag signs, scale nibble, and no -0", () => {
    // count 1. flags 0F: bit 0 (second negative), bit 1 (first negative), bit 2 (scale),
    // bit 3 (1 pair). scale = 1. values at scale 1: 2 1 4 -> 20, 0 0 -> 0.
    // -> [-20, +0].
    const out = list(0x00, 0x41, 0x0f, 0x12, 0x14, 0x00);
    expect(out).toEqual([-20, 0]);
    expect(Object.is(out[1], 0)).toBe(true);
  });
});
