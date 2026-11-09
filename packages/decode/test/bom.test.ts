import { describe, expect, it } from "vitest";
import { BomStore } from "../src/bom.js";
import { DecodeError } from "../src/errors.js";
import { ascii, buildBom, buildTree } from "./helpers/build-bom.js";

const text = (b: Uint8Array) => String.fromCharCode(...b);

describe("BomStore", () => {
  it("returns each block by index", () => {
    const bytes = buildBom({
      blocks: [ascii("one"), ascii("two!"), ascii("three")],
      vars: {},
    });
    const store = BomStore.open(bytes);
    expect(text(store.block(1))).toBe("one");
    expect(text(store.block(2))).toBe("two!");
    expect(text(store.block(3))).toBe("three");
  });

  it("rejects block 0 and out-of-range indexes", () => {
    const store = BomStore.open(buildBom({ blocks: [ascii("x")], vars: {} }));
    expect(() => store.block(0)).toThrow(DecodeError);
    expect(() => store.block(2)).toThrow(DecodeError);
  });

  it("resolves a named block through the variables table", () => {
    const store = BomStore.open(
      buildBom({
        blocks: [ascii("a"), ascii("header-bytes")],
        vars: { CARHEADER: 2 },
      }),
    );
    expect(text(store.named("CARHEADER")!)).toBe("header-bytes");
    expect(store.named("NOPE")).toBeUndefined();
  });

  it("rejects a bad magic and an index count the bytes cannot hold", () => {
    const good = buildBom({ blocks: [ascii("x")], vars: {} });
    const badMagic = good.slice();
    badMagic[0] = 0x58;
    expect(() => BomStore.open(badMagic)).toThrow(DecodeError);

    const huge = good.slice();
    const indexOffset = new DataView(huge.buffer).getUint32(16, false);
    new DataView(huge.buffer).setUint32(indexOffset, 0x7fffffff, false);
    expect(() => BomStore.open(huge)).toThrow(/count/);
  });

  describe("tree", () => {
    const entries: [Uint8Array, Uint8Array][] = [0, 1, 2, 3, 4].map((i) => [
      ascii(`key${i}`),
      ascii(`val${i}`),
    ]);
    // buildTree layout at base 1: header (1), 10 key/value blocks (2..11), leaves from 12.
    const firstLeaf = 12;

    it("enumerates 5 entries over 3 leaves and one internal node, in order", () => {
      const { blocks, header } = buildTree(entries, 2, 1);
      const store = BomStore.open(buildBom({ blocks, vars: { T: header } }));
      const out = store.tree("T");
      expect(out).toHaveLength(5);
      expect(out.map((e) => text(e.key))).toEqual(entries.map(([k]) => text(k)));
      expect(out.map((e) => text(e.value))).toEqual(entries.map(([, v]) => text(v)));
    });

    it("descends several internal levels", () => {
      const many: [Uint8Array, Uint8Array][] = Array.from({ length: 9 }, (_, i) => [
        ascii(`k${i}`),
        ascii(`v${i}`),
      ]);
      const { blocks, header } = buildTree(many, 2, 1);
      const store = BomStore.open(buildBom({ blocks, vars: { T: header } }));
      expect(store.tree("T").map((e) => text(e.key))).toEqual(many.map(([k]) => text(k)));
    });

    it("reads a single-leaf tree", () => {
      const { blocks, header } = buildTree(entries, 8, 1);
      const store = BomStore.open(buildBom({ blocks, vars: { T: header } }));
      expect(store.tree("T")).toHaveLength(5);
    });

    it("fails on a missing tree and on a root block of 0", () => {
      const { blocks, header } = buildTree(entries, 2, 1);
      const bytes = buildBom({ blocks, vars: { T: header } });
      expect(() => BomStore.open(bytes).tree("MISSING")).toThrow(DecodeError);

      const zeroRoot = blocks.slice();
      zeroRoot[0] = zeroRoot[0]!.slice();
      new DataView(zeroRoot[0]!.buffer).setUint32(8, 0, false);
      expect(() =>
        BomStore.open(buildBom({ blocks: zeroRoot, vars: { T: header } })).tree("T"),
      ).toThrow(DecodeError);
    });

    it("rejects a cyclic leaf chain instead of looping", () => {
      const { blocks, header } = buildTree(entries, 2, 1);
      const cyc = blocks.map((b) => b.slice());
      for (let i = 0; i < 3; i++) {
        new DataView(cyc[firstLeaf - 1 + i]!.buffer).setUint32(4, firstLeaf, false);
      }
      expect(() =>
        BomStore.open(buildBom({ blocks: cyc, vars: { T: header } })).tree("T"),
      ).toThrow(/revisit/);
    });

    it("rejects a leaf shorter than its pair count", () => {
      const { blocks, header } = buildTree(entries, 2, 1);
      const cut = blocks.map((b) => b.slice());
      cut[firstLeaf - 1] = cut[firstLeaf - 1]!.slice(0, 14);
      expect(() =>
        BomStore.open(buildBom({ blocks: cut, vars: { T: header } })).tree("T"),
      ).toThrow(DecodeError);
    });
  });
});
