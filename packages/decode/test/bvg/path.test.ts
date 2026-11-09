import { describe, expect, it } from "vitest";
import { DecodeError } from "../../src/errors.js";
import { decodePath, formatNumber, pathToSvg } from "../../src/bvg/path.js";
import { nibbles, PATH_HEADER } from "../helpers/nibbles.js";

// Header bytes of Docs/format/03 §3.1: 0x00, readValue(4) = 0, readValue(4) = 1.
const HEADER = [0x00, 0x00, 0x00, 0x00, 0x01];
const path = (...ns: number[]) => decodePath(nibbles(...PATH_HEADER, ...ns));

describe("decodePath (Docs/format/03 §3)", () => {
  it("[00, 0000, 0001, 70] -> Z", () => {
    expect(decodePath(new Uint8Array([...HEADER, 0x70]))).toEqual([{ op: "Z", args: [] }]);
  });

  it("a first byte other than 0x00 throws DecodeError", () => {
    expect(() => decodePath(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x01, 0x70]))).toThrow(
      DecodeError,
    );
  });

  it("a stream too short for the header throws DecodeError", () => {
    expect(() => decodePath(new Uint8Array([]))).toThrow(DecodeError);
    expect(() => decodePath(new Uint8Array([0x00, 0x00, 0x00]))).toThrow(DecodeError);
  });

  it("a trailing padding nibble after a half-byte command still ends cleanly with the Z", () => {
    // M immediate: cmd 00, nib 0, values 1 1 (5 nibbles); Z: 7 0 -> 7 nibbles + 1 pad nibble.
    // The next readByte has one nibble left and runs dry (§1.2, §1.4): end of path.
    expect(path(0, 0, 0, 1, 1, 7, 0)).toEqual([
      { op: "M", args: [1, 1] },
      { op: "Z", args: [] },
    ]);
  });

  it("current point: 0 is M first, L after, M again after Z; 8 is m/l likewise; no -0", () => {
    // 00 nib0 3 5   -> M 3 5          (no current point)
    // 00 nib0 1 2   -> L 1 2
    // 70            -> Z              (clears the current point, §3.2)
    // 80 nib4 2 0   -> m 2 0          nib 4: flags = 08 | (4>>2)&3 = 09 -> second value
    //                                  sign -1, but zero stays +0 (§3.5)
    // 80 nib0 1 1   -> l 1 1
    const cmds = path(0, 0, 0, 3, 5, 0, 0, 0, 1, 2, 7, 0, 8, 0, 4, 2, 0, 8, 0, 0, 1, 1);
    expect(cmds).toEqual([
      { op: "M", args: [3, 5] },
      { op: "L", args: [1, 2] },
      { op: "Z", args: [] },
      { op: "m", args: [2, 0] },
      { op: "l", args: [1, 1] },
    ]);
    expect(Object.is(cmds[3]!.args[1], 0)).toBe(true);
    expect(pathToSvg(cmds)).toBe("M3 5L1 2Zm2 0l1 1");
  });

  it("immediate nibble sets sign bits and scale", () => {
    // 00 nib B: flags = 08 | (B>>2)&3 = 0A (first value negative), scale = B&3 = 3.
    // At scale != 0 the integer width comes from the nibble: 2 1 4 -> 20; 0 3 -> 3.
    expect(path(0, 0, 0xb, 2, 1, 4, 0, 3)).toEqual([{ op: "M", args: [-20, 3] }]);
  });

  it("packed pairs (command bit 3): 08 nib8 [5 A B] -> M -3 43", () => {
    // cmd 0x08: high 0 -> M, low 8 -> packed, width 0 -> immediate.
    // nib 8: flags = 08 | (8>>2)&3 = 0A -> first value negative; scale 8&3 = 0; 1 pair.
    // packed pair 5 A B at scale 0 -> (3, 43) (see numbers.test.ts) -> (-3, 43).
    expect(path(0, 8, 8, 5, 0xa, 0xb)).toEqual([{ op: "M", args: [-3, 43] }]);
  });

  it("counted mode, two runs, new scale in a flag byte, odd count drops the padding", () => {
    // M: 00 nib0 1 1.
    // H: cmd 55 = high 5 (H), low 5 = width 1 + bit 2 (drop last).
    //    sets = readValue(1) = 2; flags = 08 -> 1 pair, scale 0: 7 4.
    //    flags = 0E -> bit 1 (first value negative), bit 2 (new scale), bit 3 (1 pair);
    //    scale = 1; pair: 2 1 4 -> 20, 0 0 -> 0 (integerWidths[0] = 4 -> one nibble).
    //    Values 7 4 -20 0; drop last -> H 7 4 -20.
    expect(
      path(0, 0, 0, 1, 1, 5, 5, 2, 0, 8, 7, 4, 0, 0xe, 1, 2, 1, 4, 0, 0),
    ).toEqual([
      { op: "M", args: [1, 1] },
      { op: "H", args: [7, 4, -20] },
    ]);
  });

  it("counted pair count (flag bit 3 clear) and an empty run", () => {
    // cmd 02: M, width 2 -> sets = readValue(2) = 0x02.
    // flags 00: bit 3 clear, pairs = readValue(0) = 0: an empty run (§3.5).
    // flags 10: bit 3 clear, pairs = readValue(1) = 2: values 1 2 3 4.
    expect(path(0, 2, 0, 2, 0, 0, 1, 0, 2, 1, 2, 3, 4)).toEqual([
      { op: "M", args: [1, 2, 3, 4] },
    ]);
  });

  it("a command whose runs decoded nothing is still emitted", () => {
    // cmd 01: M, width 1; sets = 1; flags 00: pairs = 0. Then Z.
    expect(path(0, 1, 1, 0, 0, 7, 0)).toEqual([
      { op: "M", args: [] },
      { op: "Z", args: [] },
    ]);
  });

  it("Z reads nothing more whatever its low nibble", () => {
    expect(decodePath(new Uint8Array([...HEADER, 0x7f, 0x70]))).toEqual([
      { op: "Z", args: [] },
      { op: "Z", args: [] },
    ]);
  });

  it("every command letter maps from its high nibble", () => {
    // Each: cmd X0 + immediate nib 0 + one pair 1 1 (after an M so 0/8 read L/l).
    const highs = [0, 1, 2, 3, 4, 5, 6, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe];
    const ns = [0, 0, 0, 1, 1];
    for (const h of highs) ns.push(h, 0, 0, 1, 1);
    expect(path(...ns).map((c) => c.op)).toEqual([
      "M", "L", "C", "S", "Q", "T", "H", "V", "l", "c", "s", "q", "t", "h", "v",
    ]);
  });

  it("high nibble 15 in command position throws DecodeError", () => {
    expect(() => decodePath(new Uint8Array([...HEADER, 0xf0]))).toThrow(DecodeError);
  });

  describe("running dry", () => {
    it("on the immediate-mode nibble: the command is not emitted", () => {
      expect(decodePath(new Uint8Array([...HEADER, 0x70, 0x00]))).toEqual([
        { op: "Z", args: [] },
      ]);
    });

    it("on the counted-mode set count: the command is not emitted", () => {
      // cmd 02: width 2 -> readValue(2) is a byte, none left.
      expect(decodePath(new Uint8Array([...HEADER, 0x70, 0x02]))).toEqual([
        { op: "Z", args: [] },
      ]);
    });

    it("on the counted-mode flag byte: the command is not emitted", () => {
      // cmd 01: width 1 -> sets = 1; then readByte has one nibble left.
      expect(decodePath(new Uint8Array([...HEADER, 0x70, 0x01, 0x10]))).toEqual([
        { op: "Z", args: [] },
      ]);
    });

    it("inside the runs: the command is emitted with its complete pairs and the path ends", () => {
      // cmd 01: M, width 1; sets = 1; flags 18: 2 pairs. Pair 1 = 1 2; pair 2 starts with
      // B (fraction follows) and the stream ends.
      expect(path(0, 1, 1, 1, 8, 1, 2, 0xb)).toEqual([{ op: "M", args: [1, 2] }]);
    });

    it("inside the runs, on the second value of a pair: the half pair is not appended", () => {
      // Same, pair 2 = 3 then nothing.
      expect(path(0, 1, 1, 1, 8, 1, 2, 3)).toEqual([{ op: "M", args: [1, 2] }]);
    });

    it("on a flag byte between runs: emitted with what it has", () => {
      // cmd 01: sets = 2; flags 08 -> 1 pair 1 2; next flag byte missing.
      expect(path(0, 1, 2, 0, 8, 1, 2)).toEqual([{ op: "M", args: [1, 2] }]);
    });
  });
});

describe("pathToSvg / formatNumber", () => {
  it("M1 -0 Z -> 'M1 0Z'", () => {
    expect(
      pathToSvg([
        { op: "M", args: [1, -0] },
        { op: "Z", args: [] },
      ]),
    ).toBe("M1 0Z");
  });

  it("joins args with single spaces, shortest round-trip", () => {
    expect(pathToSvg([{ op: "c", args: [0.1, -2.5, 10.968744, 7.959957, 0, 1] }])).toBe(
      "c0.1 -2.5 10.968744 7.959957 0 1",
    );
  });

  it("formatNumber prints -0 as 0", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(0.72917)).toBe("0.72917");
  });

  it("formatNumber uses String(n): very small magnitudes print in e notation", () => {
    // Pinned so a change of policy is visible.
    expect(formatNumber(1e-7)).toBe("1e-7");
  });
});
