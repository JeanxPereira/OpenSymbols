import { DecodeError } from "../errors.js";
import type { PlistValue } from "./index.js";

const WHERE = "bplist";
const MAGIC = "bplist00";
// Milliseconds between the Unix epoch and Apple's 2001-01-01 reference date.
const APPLE_EPOCH_MS = 978307200000;

/**
 * Parses a `bplist00` binary property list. Docs/format/05 §1.1: every count, offset and
 * reference is checked against the file size; cycles and duplicate dict keys are errors.
 */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  if (bytes.length < MAGIC.length + 32) {
    throw new DecodeError(WHERE, `file of ${bytes.length} bytes is too short for a bplist00`);
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) {
      throw new DecodeError(WHERE, "missing bplist00 header");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = bytes.length - 32;
  const offsetSize = view.getUint8(t + 6);
  const refSize = view.getUint8(t + 7);
  const numObjects = readBig(view, t + 8, 8, "numObjects");
  const topObject = readBig(view, t + 16, 8, "topObject");
  const tableOffset = readBig(view, t + 24, 8, "offsetTableOffset");
  if (offsetSize < 1 || offsetSize > 8) {
    throw new DecodeError(WHERE, `offsetIntSize ${offsetSize} is outside 1..8`);
  }
  if (refSize < 1 || refSize > 8) {
    throw new DecodeError(WHERE, `objectRefSize ${refSize} is outside 1..8`);
  }
  if (numObjects < 1 || topObject >= numObjects) {
    throw new DecodeError(WHERE, `topObject ${topObject} is outside ${numObjects} objects`);
  }
  if (tableOffset < MAGIC.length || tableOffset + numObjects * offsetSize > t) {
    throw new DecodeError(WHERE, `offset table at ${tableOffset} does not fit in the file`);
  }
  const dataEnd = tableOffset;

  const offsetOf = (index: number): number => {
    if (index >= numObjects) {
      throw new DecodeError(WHERE, `object reference ${index} is outside ${numObjects} objects`);
    }
    const off = readBig(view, tableOffset + index * offsetSize, offsetSize, "offset");
    if (off < MAGIC.length || off >= dataEnd) {
      throw new DecodeError(WHERE, `object ${index} offset ${off} is outside the object area`);
    }
    return off;
  };

  const need = (pos: number, n: number): void => {
    if (pos + n > dataEnd) {
      throw new DecodeError(WHERE, `object data at ${pos} (+${n}) runs past the object area`);
    }
  };

  // Reads the size nibble, following an int object when it is 0xF.
  const readCount = (pos: number, low: number): { count: number; pos: number } => {
    if (low !== 0xf) {
      return { count: low, pos };
    }
    need(pos, 1);
    const marker = view.getUint8(pos);
    if (marker >> 4 !== 0x1) {
      throw new DecodeError(WHERE, `count marker 0x${marker.toString(16)} is not an int`);
    }
    const width = 1 << (marker & 0xf);
    if (width > 8) {
      throw new DecodeError(WHERE, `count int of ${width} bytes is too wide`);
    }
    need(pos + 1, width);
    return { count: readBig(view, pos + 1, width, "count"), pos: pos + 1 + width };
  };

  const active = new Set<number>();

  const readObject = (index: number): PlistValue => {
    if (active.has(index)) {
      throw new DecodeError(WHERE, `object ${index} contains itself`);
    }
    const start = offsetOf(index);
    need(start, 1);
    const marker = view.getUint8(start);
    const high = marker >> 4;
    const low = marker & 0xf;
    const pos = start + 1;

    switch (high) {
      case 0x0:
        if (low === 0x8) return false;
        if (low === 0x9) return true;
        throw new DecodeError(WHERE, `unsupported marker 0x${marker.toString(16)}`);
      case 0x1: {
        const width = 1 << low;
        if (width > 8) {
          throw new DecodeError(WHERE, `int of ${width} bytes is not supported`);
        }
        need(pos, width);
        return readBig(view, pos, width, "int");
      }
      case 0x2: {
        const width = 1 << low;
        if (width !== 4 && width !== 8) {
          throw new DecodeError(WHERE, `real of ${width} bytes is not supported`);
        }
        need(pos, width);
        return width === 4 ? view.getFloat32(pos, false) : view.getFloat64(pos, false);
      }
      case 0x3: {
        if (low !== 0x3) {
          throw new DecodeError(WHERE, `unsupported marker 0x${marker.toString(16)}`);
        }
        need(pos, 8);
        return new Date(APPLE_EPOCH_MS + view.getFloat64(pos, false) * 1000);
      }
      case 0x4: {
        const c = readCount(pos, low);
        need(c.pos, c.count);
        return bytes.slice(c.pos, c.pos + c.count);
      }
      case 0x5: {
        const c = readCount(pos, low);
        need(c.pos, c.count);
        let s = "";
        for (let i = 0; i < c.count; i++) s += String.fromCharCode(bytes[c.pos + i] as number);
        return s;
      }
      case 0x6: {
        const c = readCount(pos, low);
        need(c.pos, c.count * 2);
        let s = "";
        for (let i = 0; i < c.count; i++) {
          s += String.fromCharCode(view.getUint16(c.pos + i * 2, false));
        }
        return s;
      }
      case 0xa:
      case 0xc: {
        const c = readCount(pos, low);
        need(c.pos, c.count * refSize);
        active.add(index);
        const out: PlistValue[] = [];
        for (let i = 0; i < c.count; i++) {
          out.push(readObject(readBig(view, c.pos + i * refSize, refSize, "ref")));
        }
        active.delete(index);
        return out;
      }
      case 0xd: {
        const c = readCount(pos, low);
        need(c.pos, c.count * refSize * 2);
        active.add(index);
        const out: { [k: string]: PlistValue } = {};
        for (let i = 0; i < c.count; i++) {
          const key = readObject(readBig(view, c.pos + i * refSize, refSize, "key ref"));
          if (typeof key !== "string") {
            throw new DecodeError(WHERE, `dict key ${i} of object ${index} is not a string`);
          }
          if (Object.hasOwn(out, key)) {
            throw new DecodeError(WHERE, `duplicate dict key "${key}"`);
          }
          const valueRef = readBig(view, c.pos + (c.count + i) * refSize, refSize, "value ref");
          Object.defineProperty(out, key, {
            value: readObject(valueRef),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        active.delete(index);
        return out;
      }
      default:
        throw new DecodeError(WHERE, `unsupported marker 0x${marker.toString(16)}`);
    }
  };

  return readObject(topObject);
}

function readBig(view: DataView, pos: number, width: number, what: string): number {
  let value = 0n;
  for (let i = 0; i < width; i++) {
    value = (value << 8n) | BigInt(view.getUint8(pos + i));
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DecodeError(WHERE, `${what} ${value} exceeds 2^53`);
  }
  return Number(value);
}
