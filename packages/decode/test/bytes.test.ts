import { describe, expect, it } from "vitest";
import { ByteReader } from "../src/bytes.js";
import { DecodeError } from "../src/errors.js";

describe("ByteReader", () => {
  it("reads u32be and u32le from the same four bytes", () => {
    const bytes = new Uint8Array([0, 0, 1, 2]);
    expect(new ByteReader(bytes).u32be()).toBe(258);
    expect(new ByteReader(bytes).u32le()).toBe(33619968);
  });

  it("uint(width, endian) reads little-endian values of width 1, 2 and 4", () => {
    const bytes = new Uint8Array([0x34, 0x12, 0, 0]);
    expect(new ByteReader(bytes).uint(1, "le")).toBe(0x34);
    expect(new ByteReader(bytes).uint(2, "le")).toBe(0x1234);
    expect(new ByteReader(bytes).uint(4, "le")).toBe(0x1234);
  });

  it("u32 reads return unsigned values", () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(new ByteReader(bytes).u32le()).toBe(4294967295);
    expect(new ByteReader(bytes).u32be()).toBe(4294967295);
  });

  it("reads u8, u16le and u16be and advances pos", () => {
    const reader = new ByteReader(new Uint8Array([0x7f, 0x01, 0x02]));
    expect(reader.u8()).toBe(0x7f);
    expect(reader.pos).toBe(1);
    expect(reader.u16le()).toBe(0x0201);
    expect(reader.pos).toBe(3);
    expect(new ByteReader(new Uint8Array([0x01, 0x02])).u16be()).toBe(0x0102);
  });

  it("honours a starting offset", () => {
    const reader = new ByteReader(new Uint8Array([9, 9, 1, 2]), 2);
    expect(reader.pos).toBe(2);
    expect(reader.u16be()).toBe(0x0102);
  });

  it("throws DecodeError naming the reader when reading past the end", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    reader.seek(2);
    let caught: unknown;
    try {
      reader.u16le();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DecodeError);
    expect((caught as DecodeError).where).toContain("ByteReader");
    expect((caught as DecodeError).name).toBe("DecodeError");
  });

  it("throws on bytes(n) and ascii(n) past the end", () => {
    const reader = new ByteReader(new Uint8Array([65, 66]));
    expect(() => reader.bytes(3)).toThrow(DecodeError);
    expect(() => reader.ascii(3)).toThrow(DecodeError);
    expect(reader.pos).toBe(0);
  });

  it("cstring() stops at 0 and advances past it", () => {
    const reader = new ByteReader(new Uint8Array([0x61, 0x62, 0x63, 0, 0x64]));
    expect(reader.cstring()).toBe("abc");
    expect(reader.pos).toBe(4);
    expect(reader.u8()).toBe(0x64);
  });

  it("cstring() throws when no terminator is found", () => {
    const reader = new ByteReader(new Uint8Array([0x61, 0x62]));
    expect(() => reader.cstring()).toThrow(DecodeError);
  });

  it("ascii(n) reads exactly n bytes and advances", () => {
    const reader = new ByteReader(new Uint8Array([0x68, 0x69, 0, 0x21]));
    expect(reader.ascii(3)).toBe("hi\0");
    expect(reader.pos).toBe(3);
  });

  it("bytes(n) returns the next n bytes and advances", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3, 4]));
    expect(Array.from(reader.bytes(2))).toEqual([1, 2]);
    expect(reader.pos).toBe(2);
    expect(reader.remaining()).toBe(2);
  });

  it("seek() moves pos and rejects positions outside the buffer", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    reader.seek(3);
    expect(reader.remaining()).toBe(0);
    expect(() => reader.seek(4)).toThrow(DecodeError);
    expect(() => reader.seek(-1)).toThrow(DecodeError);
  });

  it("remaining() reports bytes left after pos", () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3]));
    expect(reader.remaining()).toBe(3);
    reader.u8();
    expect(reader.remaining()).toBe(2);
  });

  it("respects a Uint8Array view with a non-zero byteOffset", () => {
    const backing = new Uint8Array([0xaa, 0xbb, 0x01, 0x02, 0xcc]);
    const view = backing.subarray(2, 4);
    expect(new ByteReader(view).u16be()).toBe(0x0102);
  });
});
