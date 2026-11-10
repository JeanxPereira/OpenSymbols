import type { PathCommand, PathOp } from "./path.js";

/** Values per step of each op (Docs/format/06 §3.5). */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, C: 6, S: 4, Q: 4, T: 2, H: 1, V: 1 };

/**
 * Docs/format/03 §7: the path as CoreUI counts its points. One command per step, every step
 * absolute, only `M L Q C Z`: `H`/`V` become `L`, `S` becomes `C` and `T` becomes `Q` with the
 * reflected control point, and the pairs after the first of an `M` become `L`. Two masters of a
 * symbol interpolate when their normalized paths have the same op letters (`pointShape`).
 * Expects a path that passed the arity check of 06 §3.5.
 */
export function normalizePath(path: readonly PathCommand[]): PathCommand[] {
  const out: PathCommand[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last step's second cubic control point or quadratic control point, for S and T.
  let lastCubic: [number, number] | undefined;
  let lastQuad: [number, number] | undefined;

  for (const { op, args } of path) {
    const upper = op.toUpperCase() as PathOp;
    if (upper === "Z") {
      out.push({ op: "Z", args: [] });
      x = startX;
      y = startY;
      lastCubic = lastQuad = undefined;
      continue;
    }
    const relative = op !== upper;
    const n = ARITY[upper] as number;
    for (let k = 0; k + n <= args.length; k += n) {
      const a = args.slice(k, k + n);
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      let cubic: [number, number] | undefined;
      let quad: [number, number] | undefined;
      switch (upper) {
        case "M":
        case "L":
          x = a[0]! + ox;
          y = a[1]! + oy;
          if (upper === "M" && k === 0) {
            startX = x;
            startY = y;
            out.push({ op: "M", args: [x, y] });
          } else {
            out.push({ op: "L", args: [x, y] });
          }
          break;
        case "H":
          x = a[0]! + ox;
          out.push({ op: "L", args: [x, y] });
          break;
        case "V":
          y = a[0]! + oy;
          out.push({ op: "L", args: [x, y] });
          break;
        case "C": {
          const s = [a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy, a[4]! + ox, a[5]! + oy];
          out.push({ op: "C", args: s });
          cubic = [s[2]!, s[3]!];
          [x, y] = [s[4]!, s[5]!];
          break;
        }
        case "S": {
          const [c1x, c1y] = lastCubic === undefined ? [x, y] : [2 * x - lastCubic[0], 2 * y - lastCubic[1]];
          const s = [c1x, c1y, a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy];
          out.push({ op: "C", args: s });
          cubic = [s[2]!, s[3]!];
          [x, y] = [s[4]!, s[5]!];
          break;
        }
        case "Q": {
          const s = [a[0]! + ox, a[1]! + oy, a[2]! + ox, a[3]! + oy];
          out.push({ op: "Q", args: s });
          quad = [s[0]!, s[1]!];
          [x, y] = [s[2]!, s[3]!];
          break;
        }
        case "T": {
          const [qx, qy] = lastQuad === undefined ? [x, y] : [2 * x - lastQuad[0], 2 * y - lastQuad[1]];
          const s = [qx, qy, a[0]! + ox, a[1]! + oy];
          out.push({ op: "Q", args: s });
          quad = [qx, qy];
          [x, y] = [s[2]!, s[3]!];
          break;
        }
      }
      lastCubic = cubic;
      lastQuad = quad;
    }
  }
  return out;
}

/** The op letters of a normalized path: equal shapes mean the masters interpolate (03 §7). */
export function pointShape(path: readonly PathCommand[]): string {
  let s = "";
  for (const c of path) s += c.op;
  return s;
}
