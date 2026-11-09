import { describe, expect, it } from "vitest";
import { NibbleReader } from "../../src/bvg/nibbles.js";

describe("NibbleReader", () => {
  it("reads high nibble first, then low, then runs dry with null", () => {
    const r = new NibbleReader(new Uint8Array([0xab, 0xcd]));
    expect([r.nibble(), r.nibble(), r.nibble(), r.nibble(), r.nibble()]).toEqual([
      0xa, 0xb, 0xc, 0xd, null,
    ]);
  });

  it("byte() mid-byte splices the low nibble with the next high nibble", () => {
    const r = new NibbleReader(new Uint8Array([0xab, 0xcd]));
    r.nibble();
    expect(r.byte()).toBe(0xbc);
    // Docs/format/03 §1.2: half stays true, so one nibble (0xD) is left.
    expect(r.atEnd()).toBe(false);
    expect(r.nibble()).toBe(0xd);
    expect(r.atEnd()).toBe(true);
  });

  it("byte() aligned returns the whole byte", () => {
    const r = new NibbleReader(new Uint8Array([0xab, 0xcd]));
    expect(r.byte()).toBe(0xab);
    expect(r.byte()).toBe(0xcd);
    expect(r.byte()).toBeNull();
  });

  it("byte() runs dry on a single remaining nibble, which is not at end", () => {
    const r = new NibbleReader(new Uint8Array([0xab]));
    r.nibble();
    expect(r.atEnd()).toBe(false);
    expect(r.byte()).toBeNull();
  });

  it("value(3) reads big-endian nibbles; value(0) reads nothing", () => {
    const r = new NibbleReader(new Uint8Array([0xab, 0xcd]));
    expect(r.value(0)).toBe(0);
    expect(r.value(3)).toBe(0xabc);
    expect(r.value(1)).toBe(0xd);
    expect(r.value(1)).toBeNull();
  });

  it("value(10) holds 40 bits exactly (Docs/format/03 §1.3)", () => {
    const r = new NibbleReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(r.value(10)).toBe(2 ** 40 - 1);
  });

  it("value(n) runs dry with null", () => {
    expect(new NibbleReader(new Uint8Array([0xab])).value(3)).toBeNull();
    expect(new NibbleReader(new Uint8Array([])).value(2)).toBeNull();
  });

  it("peekNibble() does not move", () => {
    const r = new NibbleReader(new Uint8Array([0xab]));
    expect(r.peekNibble()).toBe(0xa);
    expect(r.nibble()).toBe(0xa);
    expect(r.peekNibble()).toBe(0xb);
    r.nibble();
    expect(r.peekNibble()).toBeNull();
  });
});
