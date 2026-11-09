import { DecodeError } from "./errors.js";

const READER = "ByteReader";

export class ByteReader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  pos: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
    this.seek(offset);
  }

  u8(): number {
    this.#need(1);
    const value = this.#view.getUint8(this.pos);
    this.pos += 1;
    return value;
  }

  u16le(): number {
    return this.uint(2, "le");
  }

  u16be(): number {
    return this.uint(2, "be");
  }

  u32le(): number {
    return this.uint(4, "le");
  }

  u32be(): number {
    return this.uint(4, "be");
  }

  uint(width: 1 | 2 | 4, endian: "le" | "be"): number {
    if (width === 1) {
      return this.u8();
    }
    this.#need(width);
    const littleEndian = endian === "le";
    const value =
      width === 2
        ? this.#view.getUint16(this.pos, littleEndian)
        : this.#view.getUint32(this.pos, littleEndian);
    this.pos += width;
    return value;
  }

  bytes(n: number): Uint8Array {
    this.#need(n);
    const out = this.#bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  ascii(n: number): string {
    this.#need(n);
    let out = "";
    for (let i = 0; i < n; i++) {
      out += String.fromCharCode(this.#bytes[this.pos + i] as number);
    }
    this.pos += n;
    return out;
  }

  cstring(): string {
    let end = this.pos;
    while (end < this.#bytes.length && this.#bytes[end] !== 0) {
      end++;
    }
    if (end >= this.#bytes.length) {
      throw new DecodeError(
        READER,
        `unterminated string at offset ${this.pos}`,
      );
    }
    const out = this.ascii(end - this.pos);
    this.pos += 1;
    return out;
  }

  seek(pos: number): void {
    if (!Number.isInteger(pos) || pos < 0 || pos > this.#bytes.length) {
      throw new DecodeError(
        READER,
        `seek to ${pos} is outside 0..${this.#bytes.length}`,
      );
    }
    this.pos = pos;
  }

  remaining(): number {
    return this.#bytes.length - this.pos;
  }

  #need(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n > this.remaining()) {
      throw new DecodeError(
        READER,
        `need ${n} bytes at offset ${this.pos}, have ${this.remaining()}`,
      );
    }
  }
}
