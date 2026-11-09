import { describe, expect, it } from "vitest";
import { DecodeError } from "../../src/errors.js";
import { LOCAL_BASE, PREDEFINED } from "../../src/bvg/atoms.js";
import { parseBvg } from "../../src/bvg/document.js";
import { buildBvg, LIST_0_0_3_5, PATH_Z, type NodeSpec } from "../helpers/build-bvg.js";

// root g (atom 1); one path (atom 3) child with class index 1, opacity (20) = atom 33 ("0.0")
const pathNode: NodeSpec = { tag: 3, classes: [1], attrs: [{ name: 20, value: 33 }] };
const rootNode: NodeSpec = { tag: 1, children: [pathNode] };
const build = (typeCode: number) =>
  buildBvg({
    typeCode,
    localStrings: ["first", "second"],
    idPairs: [{ stringIndex: 89, target: pathNode }],
    root: rootNode,
  });

describe("PREDEFINED (Docs/format/02 §3)", () => {
  it("has 89 atoms with known anchors", () => {
    expect(PREDEFINED.length).toBe(89);
    expect(LOCAL_BASE).toBe(89);
    expect(PREDEFINED[34]).toBe("-sfsymbols-motion-group");
    expect(PREDEFINED[88]).toBe("custom");
    expect(PREDEFINED[22]).toBe("d");
    expect(PREDEFINED[61]).toBe("data-clipstroke-keyframes");
  });
});

describe("parseBvg (Docs/format/02)", () => {
  it("parses the same logical document at 0x11, 0x12 and 0x22 to equal trees", () => {
    const docs = [0x11, 0x12, 0x22].map((t) => parseBvg(build(t)));
    expect(docs[1]?.root).toEqual(docs[0]?.root);
    expect(docs[2]?.root).toEqual(docs[0]?.root);
    const d = docs[0]!;
    expect([docs[0]!.indexWidth, docs[0]!.offsetWidth]).toEqual([1, 1]);
    expect([docs[1]!.indexWidth, docs[1]!.offsetWidth]).toEqual([1, 2]);
    expect([docs[2]!.indexWidth, docs[2]!.offsetWidth]).toEqual([2, 2]);
    expect(d.version).toBe(1);
    expect(d.root.tag).toBe("g");
    expect(d.root.tagIndex).toBe(1);
    expect(d.root.id).toBeUndefined();
    const child = d.root.children[0]!;
    expect(child.tag).toBe("path");
    expect(child.classIndices).toEqual([1]);
    expect(child.attrs).toEqual([
      { name: "opacity", nameIndex: 20, value: { kind: "string", text: "0.0" } },
    ]);
  });

  it("resolves strings: atoms below 89, locals from 89", () => {
    const d = parseBvg(build(0x12));
    expect(d.stringAt(3)).toBe("path");
    expect(d.stringAt(89)).toBe("first");
    expect(d.stringAt(90)).toBe("second");
    expect(d.strings).toEqual(["first", "second"]);
    expect(() => d.stringAt(91)).toThrow(DecodeError);
    expect(() => d.stringAt(-1)).toThrow(DecodeError);
  });

  it("gives a node its id from the id table", () => {
    const d = parseBvg(build(0x22));
    expect(d.root.children[0]?.id).toBe("first");
  });

  it("dispatches by name index: 22 path blob, 2 and 61 list blobs, else string", () => {
    const node: NodeSpec = {
      tag: 0,
      attrs: [
        { name: 22, value: 89 },
        { name: 2, value: 90 },
        { name: 61, value: 90 },
        { name: 91, value: 92 }, // local name: plain text value
      ],
    };
    const d = parseBvg(
      buildBvg({
        typeCode: 0x12,
        localStrings: [PATH_Z, LIST_0_0_3_5, "data-d", "0 1.0"],
        root: node,
      }),
    );
    const a = d.root.attrs;
    expect(a[0]?.value).toEqual({ kind: "path", commands: [{ op: "Z", args: [] }] });
    expect(a[1]?.value).toEqual({ kind: "list", values: [0, 0, 3, 5] });
    expect(a[2]?.value).toEqual({ kind: "list", values: [0, 0, 3, 5] });
    expect(a[3]).toEqual({
      name: "data-d",
      nameIndex: 91,
      value: { kind: "string", text: "0 1.0" },
    });
  });

  it("a path/list attribute whose value is an atom yields that atom's text", () => {
    const d = parseBvg(
      buildBvg({ typeCode: 0x11, root: { tag: 0, attrs: [{ name: 22, value: 31 }] } }),
    );
    expect(d.root.attrs[0]?.value).toEqual({ kind: "string", text: "0" });
  });

  it("exposes the style block bytes verbatim", () => {
    const d = parseBvg(
      buildBvg({ typeCode: 0x12, localStrings: ["a"], style: [9, 8, 7], root: { tag: 0 } }),
    );
    expect(Array.from(d.styleBytes)).toEqual([9, 8, 7]);
  });

  it("rejects version 2, bad magic, bad widths", () => {
    expect(() =>
      parseBvg(buildBvg({ typeCode: 0x12, version: 2, root: { tag: 0 } })),
    ).toThrow(DecodeError);
    const bad = buildBvg({ typeCode: 0x12, root: { tag: 0 } });
    bad[0] = 0x58;
    expect(() => parseBvg(bad)).toThrow(DecodeError);
    expect(() => parseBvg(buildBvg({ typeCode: 0x13, root: { tag: 0 } }))).toThrow(DecodeError);
    expect(() => parseBvg(buildBvg({ typeCode: 0x02, root: { tag: 0 } }))).toThrow(DecodeError);
  });

  it("rejects truncation, a huge stringCount, decreasing offsets, styleOffset > nodeOffset", () => {
    const ok = build(0x12);
    expect(() => parseBvg(ok.slice(0, ok.length - 1))).toThrow(DecodeError);
    expect(() => parseBvg(ok.slice(0, 6))).toThrow(DecodeError);
    const huge = ok.slice();
    huge[10] = 0xff; // stringCount (u16 at 6 + 2 + 2)
    huge[11] = 0xff;
    expect(() => parseBvg(huge)).toThrow(DecodeError);
    const dec = ok.slice();
    dec[12] = 0xff; // stringOffsets[0] > stringOffsets[1]
    expect(() => parseBvg(dec)).toThrow(DecodeError);
    const sty = ok.slice();
    sty[6] = 8; // nodeOffset < styleOffset
    sty[7] = 0;
    expect(() => parseBvg(sty)).toThrow(DecodeError);
  });

  it("rejects a child offset that does not advance (cycle) and excess depth", () => {
    const ok = buildBvg({ typeCode: 0x11, root: { tag: 1, children: [{ tag: 3 }] } });
    const cyc = ok.slice();
    // 0x11: root record at nodeOffset + 1 (pairCount); childOffset field after tag, id, 3 counts.
    const nodeOffset = cyc[6]!;
    cyc[nodeOffset + 1 + 5] = 1; // child points at the root itself
    expect(() => parseBvg(cyc)).toThrow(DecodeError);

    let deep: NodeSpec = { tag: 1 };
    for (let i = 0; i < 70; i++) deep = { tag: 1, children: [deep] };
    expect(() => parseBvg(buildBvg({ typeCode: 0x12, root: deep }))).toThrow(DecodeError);
  });
});
