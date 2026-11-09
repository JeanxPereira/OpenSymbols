import { DecodeError } from "../errors.js";
import { parseBinaryPlist } from "./binary.js";
import { parseXmlPlist } from "./xml.js";

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | { [k: string]: PlistValue };

const BPLIST = "bplist00";

/**
 * Docs/format/05 §1.2: dispatch on the first bytes. `bplist00` is binary, otherwise XML.
 * The bundle's `.strings` files are binary plists too (§1.1); doc 05 lists no old-style
 * text form, so none is accepted.
 */
export function parsePlist(bytes: Uint8Array): PlistValue {
  const isBinary = BPLIST.split("").every((c, i) => bytes[i] === c.charCodeAt(0));
  if (isBinary) return parseBinaryPlist(bytes);
  const head = new TextDecoder("utf-8")
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, "")
    .trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<plist") || head.startsWith("<!DOCTYPE")) {
    return parseXmlPlist(bytes);
  }
  throw new DecodeError("plist", "neither a bplist00 nor an XML property list");
}
