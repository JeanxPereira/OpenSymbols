import { DecodeError } from "../errors.js";
import type { PlistValue } from "./index.js";

const WHERE = "xml plist";

type Token =
  | { kind: "open"; name: string; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

/** Parses an XML property list (Docs/format/05 §1.2): the app's metadata files. */
export function parseXmlPlist(bytes: Uint8Array): PlistValue {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const tokens = tokenize(text);
  let i = 0;

  const peek = (): Token | undefined => tokens[i];
  const skipText = (): void => {
    while (peek()?.kind === "text") i++;
  };
  const expectClose = (name: string): void => {
    const t = tokens[i++];
    if (t?.kind !== "close" || t.name !== name) {
      throw new DecodeError(WHERE, `expected </${name}>`);
    }
  };
  // Text content of a leaf element whose open tag was just consumed.
  const leafText = (name: string, selfClosing: boolean): string => {
    if (selfClosing) return "";
    let s = "";
    for (let t = peek(); t?.kind === "text"; t = peek()) {
      s += t.text;
      i++;
    }
    expectClose(name);
    return s;
  };

  const readValue = (): PlistValue => {
    const t = tokens[i++];
    if (t?.kind !== "open") {
      throw new DecodeError(WHERE, "expected a value element");
    }
    switch (t.name) {
      case "true":
      case "false":
        leafText(t.name, t.selfClosing);
        return t.name === "true";
      case "string":
        return leafText(t.name, t.selfClosing);
      case "integer": {
        const s = leafText(t.name, t.selfClosing).trim();
        if (!/^[+-]?\d+$/.test(s)) throw new DecodeError(WHERE, `bad integer "${s}"`);
        return Number(s);
      }
      case "real": {
        const s = leafText(t.name, t.selfClosing).trim();
        const n = Number(s);
        if (s === "" || Number.isNaN(n)) throw new DecodeError(WHERE, `bad real "${s}"`);
        return n;
      }
      case "date": {
        const s = leafText(t.name, t.selfClosing).trim();
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) throw new DecodeError(WHERE, `bad date "${s}"`);
        return d;
      }
      case "data": {
        const s = leafText(t.name, t.selfClosing).replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
          throw new DecodeError(WHERE, "bad base64 in <data>");
        }
        return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      }
      case "array": {
        const out: PlistValue[] = [];
        if (t.selfClosing) return out;
        skipText();
        while (peek()?.kind === "open") {
          out.push(readValue());
          skipText();
        }
        expectClose("array");
        return out;
      }
      case "dict": {
        const out: { [k: string]: PlistValue } = {};
        if (t.selfClosing) return out;
        for (;;) {
          skipText();
          const next = peek();
          if (next?.kind !== "open") break;
          if (next.name !== "key") {
            throw new DecodeError(WHERE, `expected <key>, found <${next.name}>`);
          }
          i++;
          const key = leafText("key", next.selfClosing);
          skipText();
          if (Object.hasOwn(out, key)) {
            throw new DecodeError(WHERE, `duplicate dict key "${key}"`);
          }
          Object.defineProperty(out, key, {
            value: readValue(),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        expectClose("dict");
        return out;
      }
      default:
        throw new DecodeError(WHERE, `unsupported element <${t.name}>`);
    }
  };

  skipText();
  const root = tokens[i++];
  if (root?.kind !== "open" || root.name !== "plist") {
    throw new DecodeError(WHERE, "missing <plist> root");
  }
  skipText();
  const value = readValue();
  skipText();
  expectClose("plist");
  return value;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let pos = 0;
  while (pos < src.length) {
    if (src[pos] !== "<") {
      const end = src.indexOf("<", pos);
      const stop = end < 0 ? src.length : end;
      out.push({ kind: "text", text: decodeEntities(src.slice(pos, stop)) });
      pos = stop;
      continue;
    }
    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos + 4);
      if (end < 0) throw new DecodeError(WHERE, "unterminated comment");
      pos = end + 3;
    } else if (src.startsWith("<![CDATA[", pos)) {
      const end = src.indexOf("]]>", pos + 9);
      if (end < 0) throw new DecodeError(WHERE, "unterminated CDATA");
      out.push({ kind: "text", text: src.slice(pos + 9, end) });
      pos = end + 3;
    } else if (src.startsWith("<?", pos)) {
      const end = src.indexOf("?>", pos + 2);
      if (end < 0) throw new DecodeError(WHERE, "unterminated processing instruction");
      pos = end + 2;
    } else if (src.startsWith("<!", pos)) {
      // DOCTYPE, possibly with an internal subset in [ ... ].
      let depth = 0;
      let p = pos + 2;
      for (; p < src.length; p++) {
        const c = src[p];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (p >= src.length) throw new DecodeError(WHERE, "unterminated declaration");
      pos = p + 1;
    } else {
      const end = src.indexOf(">", pos);
      if (end < 0) throw new DecodeError(WHERE, "unterminated tag");
      const body = src.slice(pos + 1, end);
      if (body.startsWith("/")) {
        out.push({ kind: "close", name: body.slice(1).trim() });
      } else {
        const selfClosing = body.endsWith("/");
        const inner = selfClosing ? body.slice(0, -1) : body;
        const name = inner.trim().split(/\s+/)[0] ?? "";
        if (name === "") throw new DecodeError(WHERE, "empty tag name");
        out.push({ kind: "open", name, selfClosing });
      }
      pos = end + 1;
    }
  }
  return out;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!(code >= 0 && code <= 0x10ffff)) {
        throw new DecodeError(WHERE, `entity ${m} is outside Unicode (05 §1.2)`);
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED[body];
    if (named === undefined) throw new DecodeError(WHERE, `unknown entity ${m}`);
    return named;
  });
}
