import { describe, expect, it } from "vitest";
import { DecodeError } from "../src/errors.js";
import { parsePlist } from "../src/plist/index.js";
import { buildBplist } from "./helpers/build-plist.js";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const xml = (body: string): Uint8Array =>
  text(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${body}</plist>\n`,
  );

describe("parsePlist: binary (Docs/format/05 §1.1)", () => {
  it("round-trips {a: 'x', b: [1, true]}", () => {
    const bytes = buildBplist({ a: "x", b: [1, true] });
    expect(parsePlist(bytes)).toEqual({ a: "x", b: [1, true] });
  });

  it("decodes UTF-16BE strings and 2-byte ints", () => {
    const bytes = buildBplist({ k: "café ☃", n: 1000 });
    expect(parsePlist(bytes)).toEqual({ k: "café ☃", n: 1000 });
  });

  it("follows the 0xF count into an int object for long arrays", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    expect(parsePlist(buildBplist(arr))).toEqual(arr);
  });

  it("rejects a truncated file", () => {
    const bytes = buildBplist({ a: "x" });
    expect(() => parsePlist(bytes.subarray(0, 20))).toThrow(DecodeError);
  });

  it("rejects an offset table that points outside the file", () => {
    const bytes = buildBplist({ a: "x" }).slice();
    bytes[bytes.length - 1] = 0xff; // offsetTableOffset low byte
    expect(() => parsePlist(bytes)).toThrow(DecodeError);
  });

  it("rejects a dict key reference that is out of range", () => {
    const bytes = buildBplist({ a: "x" }).slice();
    bytes[9 + 1] = 0x7f; // first key ref of the top dict (marker at byte 8)
    expect(() => parsePlist(bytes)).toThrow(DecodeError);
  });

  it("rejects an object that contains itself", () => {
    // Hand-built: one array object whose only element is object 0.
    const objects = [0xa1, 0x00];
    const out = [...text("bplist00"), ...objects, 8]; // offset table: object 0 at byte 8
    out.push(0, 0, 0, 0, 0, 0, 1, 1);
    out.push(0, 0, 0, 0, 0, 0, 0, 1); // numObjects
    out.push(0, 0, 0, 0, 0, 0, 0, 0); // topObject
    out.push(0, 0, 0, 0, 0, 0, 0, 10); // offsetTableOffset
    expect(() => parsePlist(Uint8Array.from(out))).toThrow(/contains itself/);
  });

  it("rejects null and UID objects, naming the marker (05 section 1.1)", () => {
    // One top object at byte 8: its marker bytes, then a one-entry offset table.
    const single = (objects: number[]) => {
      const out = [...text("bplist00"), ...objects, 8];
      out.push(0, 0, 0, 0, 0, 0, 1, 1);
      out.push(0, 0, 0, 0, 0, 0, 0, 1); // numObjects
      out.push(0, 0, 0, 0, 0, 0, 0, 0); // topObject
      out.push(0, 0, 0, 0, 0, 0, 0, 8 + objects.length); // offsetTableOffset
      return Uint8Array.from(out);
    };
    expect(() => parsePlist(single([0x00]))).toThrow(DecodeError);
    expect(() => parsePlist(single([0x00]))).toThrow(/0x0\b/);
    expect(() => parsePlist(single([0x80, 0x01]))).toThrow(DecodeError);
    expect(() => parsePlist(single([0x80, 0x01]))).toThrow(/0x80/);
  });

  it("rejects duplicate dict keys", () => {
    // dict of 2 entries: keys "a","a" (objects 1,2), values true,false (objects 3,4).
    const objects = [0xd2, 1, 2, 3, 4, 0x51, 0x61, 0x51, 0x61, 0x09, 0x08];
    const offsets = [8, 13, 15, 17, 18];
    const out = [...text("bplist00"), ...objects, ...offsets];
    out.push(0, 0, 0, 0, 0, 0, 1, 1);
    out.push(0, 0, 0, 0, 0, 0, 0, 5);
    out.push(0, 0, 0, 0, 0, 0, 0, 0);
    out.push(0, 0, 0, 0, 0, 0, 0, 8 + objects.length);
    expect(() => parsePlist(Uint8Array.from(out))).toThrow(/duplicate dict key/);
  });
});

describe("parsePlist: XML (Docs/format/05 §1.2)", () => {
  it("parses the same dict as the binary form", () => {
    const parsed = parsePlist(
      xml(
        "<dict><key>a</key><string>x</string><key>b</key><array><integer>1</integer><true/></array></dict>",
      ),
    );
    expect(parsed).toEqual({ a: "x", b: [1, true] });
    expect(parsed).toEqual(parsePlist(buildBplist({ a: "x", b: [1, true] })));
  });

  it("rejects a numeric entity outside Unicode with a DecodeError", () => {
    for (const e of ["&#x110000;", "&#99999999999;"]) {
      expect(() => parsePlist(xml(`<string>${e}</string>`))).toThrow(DecodeError);
      expect(() => parsePlist(xml(`<string>${e}</string>`))).toThrow(/entity/);
    }
  });

  it("handles entities, reals, false, empty containers and whitespace", () => {
    const parsed = parsePlist(
      xml(`
        <dict>
          <key>Privacy &amp; Security</key> <string>a &lt;b&gt; &#65;&#x42;</string>
          <key>r</key><real>2.5</real>
          <key>f</key><false/>
          <key>e</key><array/>
          <key>d</key><dict></dict>
          <key>s</key><string/>
        </dict>`),
    );
    expect(parsed).toEqual({
      "Privacy & Security": "a <b> AB",
      r: 2.5,
      f: false,
      e: [],
      d: {},
      s: "",
    });
  });

  it("keeps keys like __proto__ as own data", () => {
    const parsed = parsePlist(xml("<dict><key>__proto__</key><string>x</string></dict>")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
  });

  it("rejects duplicate keys, unknown elements and a missing root", () => {
    expect(() =>
      parsePlist(xml("<dict><key>a</key><true/><key>a</key><true/></dict>")),
    ).toThrow(/duplicate dict key/);
    expect(() => parsePlist(xml("<bogus/>"))).toThrow(DecodeError);
    expect(() => parsePlist(text("<?xml version='1.0'?><dict/>"))).toThrow(DecodeError);
  });

  it("rejects bytes that are neither form", () => {
    expect(() => parsePlist(text('"a" = "b";'))).toThrow(DecodeError);
  });
});
