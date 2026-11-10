import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/bvg/path.js";
import { normalizePath, pointShape } from "../../src/bvg/normalize.js";

const c = (op: PathCommand["op"], ...args: number[]): PathCommand => ({ op, args });

describe("normalizePath (Docs/format/03 §7)", () => {
  it("splits a command carrying several steps into one command per step", () => {
    expect(normalizePath([c("M", 0, 0), c("c", 1, 0, 2, 0, 2, 1, 0, 1, 0, 2, -1, 2)])).toEqual([
      c("M", 0, 0),
      c("C", 1, 0, 2, 0, 2, 1),
      c("C", 2, 2, 2, 3, 1, 3),
    ]);
  });

  it("makes relative steps absolute, from the end of the previous step", () => {
    expect(normalizePath([c("m", 10, 20), c("l", 1, 2, 3, 4), c("h", 5), c("v", -6)])).toEqual([
      c("M", 10, 20),
      c("L", 11, 22),
      c("L", 14, 26),
      c("L", 19, 26),
      c("L", 19, 20),
    ]);
  });

  it("H and V become L with the other coordinate kept", () => {
    expect(normalizePath([c("M", 1, 2), c("H", 7), c("V", 9)])).toEqual([
      c("M", 1, 2),
      c("L", 7, 2),
      c("L", 7, 9),
    ]);
  });

  it("the pairs after the first of an M are line steps (SVG 1.1 §8.3.2)", () => {
    expect(normalizePath([c("m", 1, 1, 2, 0, 0, 2)])).toEqual([c("M", 1, 1), c("L", 3, 1), c("L", 3, 3)]);
  });

  it("S reflects the previous cubic's second control point, else uses the current point", () => {
    expect(normalizePath([c("M", 0, 0), c("C", 0, 1, 1, 2, 2, 2), c("S", 4, 0, 4, 0)])).toEqual([
      c("M", 0, 0),
      c("C", 0, 1, 1, 2, 2, 2),
      c("C", 3, 2, 4, 0, 4, 0),
    ]);
    expect(normalizePath([c("M", 0, 0), c("L", 2, 0), c("s", 1, 1, 2, 0)])).toEqual([
      c("M", 0, 0),
      c("L", 2, 0),
      c("C", 2, 0, 3, 1, 4, 0),
    ]);
  });

  it("T reflects the previous quadratic's control point, else uses the current point", () => {
    expect(normalizePath([c("M", 0, 0), c("Q", 1, 1, 2, 0), c("t", 2, 0)])).toEqual([
      c("M", 0, 0),
      c("Q", 1, 1, 2, 0),
      c("Q", 3, -1, 4, 0),
    ]);
    expect(normalizePath([c("M", 0, 0), c("T", 2, 0)])).toEqual([c("M", 0, 0), c("Q", 0, 0, 2, 0)]);
  });

  it("Z returns to the subpath start, so a relative step after it starts there", () => {
    expect(normalizePath([c("M", 5, 5), c("l", 1, 0), c("Z"), c("l", 0, 1)])).toEqual([
      c("M", 5, 5),
      c("L", 6, 5),
      c("Z"),
      c("L", 5, 6),
    ]);
  });

  it("a command whose runs decoded nothing has no step and is dropped (06 §3.5)", () => {
    expect(normalizePath([c("M", 0, 0), c("l"), c("L", 1, 1)])).toEqual([c("M", 0, 0), c("L", 1, 1)]);
  });

  it("the same geometry written two ways normalizes the same: c+s against one packed c", () => {
    // zzz, master 1 against master 4 (Docs/format/03 §7): the encoder chose differently.
    const a = normalizePath([c("m", 468, 43), c("h", 324), c("c", 15, 0, 23, -9, 23, -23), c("s", -8, -23, -23, -23)]);
    const b = normalizePath([c("m", 468, 43), c("h", 324), c("c", 15, 0, 23, -9, 23, -23, 0, -14, -8, -23, -23, -23)]);
    expect(pointShape(a)).toBe(pointShape(b));
    expect(a).toEqual(b);
  });
});

describe("pointShape", () => {
  it("is the op letters of the normalized path", () => {
    expect(pointShape(normalizePath([c("m", 0, 0), c("h", 1), c("s", 1, 1, 2, 0), c("Z")]))).toBe("MLCZ");
  });
});
