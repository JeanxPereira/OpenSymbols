import { argOffsets, formatNumber } from "@opensymbols/core";

/**
 * The geometry under the Draw clip (Docs/format/08): a layer's commands as closed subpaths of
 * absolute lines and cubics, measured by arc length.
 */

/** A line `[x0 y0 x1 y1]` or a cubic `[x0 y0 x1 y1 x2 y2 x3 y3]`, absolute path coordinates. */
export interface Seg {
  p: number[];
  len: number;
  /** The closing lineto of its loop (written as `Z` when the loop is emitted whole). */
  closing: boolean;
  /** Cubics: the arc length at `t = k / TABLE`, `k = 0 … TABLE`. */
  tab?: number[];
}

/** A closed, measured loop: a subpath, a joined pair (08 §4) or a piece of one (08 §8, §9). */
export interface Loop {
  segs: Seg[];
  /** `cum[i]` = arc position where segment `i` starts; `cum[segs.length]` = `length`. */
  cum: number[];
  length: number;
  start: [number, number];
}

export type Matrix6 = readonly [number, number, number, number, number, number];

/** 08 §5.1: segments with `length² ≤ 1e-8` are dropped. */
const MIN_LEN = 1e-4;
const TABLE = 16;

// ---- cubics ----

/** 5-point Gauss–Legendre nodes and weights on [−1, 1]. */
const GX = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GW = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

function speed(p: number[], t: number): number {
  const u = 1 - t;
  const dx = 3 * (u * u * (p[2]! - p[0]!) + 2 * u * t * (p[4]! - p[2]!) + t * t * (p[6]! - p[4]!));
  const dy = 3 * (u * u * (p[3]! - p[1]!) + 2 * u * t * (p[5]! - p[3]!) + t * t * (p[7]! - p[5]!));
  return Math.hypot(dx, dy);
}

/** Arc length of a cubic over `[t0, t1]` (one Gauss–Legendre panel; callers keep panels short). */
function panel(p: number[], t0: number, t1: number): number {
  const h = (t1 - t0) / 2;
  const m = (t0 + t1) / 2;
  let s = 0;
  for (let i = 0; i < 5; i++) s += GW[i]! * speed(p, m + h * GX[i]!);
  return s * h;
}

function cubicTable(p: number[]): number[] {
  const tab = [0];
  for (let k = 0; k < TABLE; k++) tab.push(tab[k]! + panel(p, k / TABLE, (k + 1) / TABLE));
  return tab;
}

/** The parameter where the cubic's arc length from 0 reaches `s` (Newton, bisection-guarded). */
function cubicParam(seg: Seg, s: number): number {
  const tab = seg.tab!;
  if (s <= 0) return 0;
  if (s >= seg.len) return 1;
  let k = 0;
  while (k < TABLE - 1 && tab[k + 1]! < s) k++;
  let a = k / TABLE;
  let b = (k + 1) / TABLE;
  const base = tab[k]!;
  let t = a + ((s - base) / (tab[k + 1]! - base || 1)) * (b - a);
  for (let i = 0; i < 30; i++) {
    const err = base + panel(seg.p, k / TABLE, t) - s;
    if (Math.abs(err) < 1e-10) break;
    if (err > 0) b = t;
    else a = t;
    const v = speed(seg.p, t);
    let next = v > 1e-12 ? t - err / v : (a + b) / 2;
    if (!(next > a && next < b)) next = (a + b) / 2;
    t = next;
  }
  return t;
}

/** de Casteljau: the part of cubic `p` over `[t0, t1]`. */
export function subCubic(p: number[], t0: number, t1: number): number[] {
  const at = (q: number[], t: number): [number[], number[]] => {
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const x01 = lerp(q[0]!, q[2]!), y01 = lerp(q[1]!, q[3]!);
    const x12 = lerp(q[2]!, q[4]!), y12 = lerp(q[3]!, q[5]!);
    const x23 = lerp(q[4]!, q[6]!), y23 = lerp(q[5]!, q[7]!);
    const xa = lerp(x01, x12), ya = lerp(y01, y12);
    const xb = lerp(x12, x23), yb = lerp(y12, y23);
    const x = lerp(xa, xb), y = lerp(ya, yb);
    return [
      [q[0]!, q[1]!, x01, y01, xa, ya, x, y],
      [x, y, xb, yb, x23, y23, q[6]!, q[7]!],
    ];
  };
  let q = p;
  if (t1 < 1) q = at(q, t1)[0];
  if (t0 > 0) q = at(q, t1 > 0 ? t0 / t1 : 0)[1];
  if (t0 <= 0) q = [p[0]!, p[1]!, ...q.slice(2)];
  if (t1 >= 1) q = [...q.slice(0, 6), p[6]!, p[7]!];
  return q;
}

// ---- segments and loops ----

export function makeSeg(p: number[], closing = false): Seg {
  if (p.length === 4) return { p, len: Math.hypot(p[2]! - p[0]!, p[3]! - p[1]!), closing };
  const tab = cubicTable(p);
  return { p, len: tab[TABLE]!, closing, tab };
}

/** A loop from segments; drops the ones too short to measure (08 §5.1). */
export function makeLoop(segs: Seg[], start: [number, number]): Loop {
  const kept = segs.filter((s) => s.len > MIN_LEN && Number.isFinite(s.len));
  const cum = [0];
  for (const s of kept) cum.push(cum[cum.length - 1]! + s.len);
  return { segs: kept, cum, length: cum[kept.length]!, start };
}

/** The segment holding position `s`: the one ending there (`before`) or starting there. */
function segAt(loop: Loop, s: number, before: boolean): number {
  const n = loop.segs.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const end = loop.cum[mid + 1]!;
    if (before ? end < s : end <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const endPoint = (seg: Seg): [number, number] => [seg.p[seg.p.length - 2]!, seg.p[seg.p.length - 1]!];

function localParam(seg: Seg, local: number): number {
  return seg.tab ? cubicParam(seg, local) : Math.min(Math.max(local / (seg.len || 1), 0), 1);
}

function evalSeg(seg: Seg, t: number): [number, number] {
  const p = seg.p;
  if (!seg.tab) return [p[0]! + (p[2]! - p[0]!) * t, p[1]! + (p[3]! - p[1]!) * t];
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0]! + b * p[2]! + c * p[4]! + d * p[6]!, a * p[1]! + b * p[3]! + c * p[5]! + d * p[7]!];
}

/** Unit tangent of a segment at `t`; at a cubic's end with a coincident handle, the next control point decides. */
function tangentSeg(seg: Seg, t: number): [number, number] {
  const p = seg.p;
  let dx: number;
  let dy: number;
  if (!seg.tab) {
    dx = p[2]! - p[0]!;
    dy = p[3]! - p[1]!;
  } else {
    const u = 1 - t;
    dx = 3 * (u * u * (p[2]! - p[0]!) + 2 * u * t * (p[4]! - p[2]!) + t * t * (p[6]! - p[4]!));
    dy = 3 * (u * u * (p[3]! - p[1]!) + 2 * u * t * (p[5]! - p[3]!) + t * t * (p[7]! - p[5]!));
    if (Math.hypot(dx, dy) < 1e-12) {
      // Degenerate end tangent: fall back to the chord to the next distinct control point.
      const pts = t < 0.5 ? [2, 4, 6] : [4, 2, 0];
      const [ox, oy] = t < 0.5 ? [p[0]!, p[1]!] : [p[6]!, p[7]!];
      for (const i of pts) {
        dx = t < 0.5 ? p[i]! - ox : ox - p[i]!;
        dy = t < 0.5 ? p[i + 1]! - oy : oy - p[i + 1]!;
        if (Math.hypot(dx, dy) > 1e-12) break;
      }
    }
  }
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Position `s` (wrapped into the loop) as a point. */
export function pointAt(loop: Loop, s: number): [number, number] {
  if (loop.segs.length === 0) return [...loop.start];
  const x = wrap(s, loop.length);
  const i = segAt(loop, x, false);
  const seg = loop.segs[i]!;
  return evalSeg(seg, localParam(seg, x - loop.cum[i]!));
}

/** The unit travel direction at `s`: of the segment arriving there (`before`) or leaving it. */
export function tangentAt(loop: Loop, s: number, before: boolean): [number, number] {
  if (loop.segs.length === 0) return [1, 0];
  let x = wrap(s, loop.length);
  if (before && x === 0) x = loop.length;
  const i = segAt(loop, x, before);
  const seg = loop.segs[i]!;
  return tangentSeg(seg, localParam(seg, x - loop.cum[i]!));
}

export const wrap = (s: number, L: number): number => {
  if (!(L > 0)) return 0;
  const r = s % L;
  return r < 0 ? r + L : r;
};

/**
 * The outline from position `a` to `b` (`a ≤ b`, `b` may exceed the length: the walk wraps, 08
 * §6.3 step 5), as segments, curves split where the cut falls (08 §6.3 step 4).
 */
export function extract(loop: Loop, a: number, b: number, out: number[][]): void {
  const L = loop.length;
  if (!(L > 0) || !(b > a)) return;
  let s = a;
  let guard = 0;
  while (s < b - 1e-9 && guard++ < 4 * loop.segs.length + 8) {
    const lap = Math.floor(s / L) * L;
    const x = s - lap;
    const i = segAt(loop, x, false);
    const seg = loop.segs[i]!;
    const segStart = lap + loop.cum[i]!;
    const segEnd = segStart + seg.len;
    const from = s - segStart;
    const to = Math.min(b, segEnd) - segStart;
    if (to - from > 1e-9) {
      if (!seg.tab) {
        const t0 = from / seg.len;
        const t1 = to / seg.len;
        const p = seg.p;
        const pt = (t: number) => [p[0]! + (p[2]! - p[0]!) * t, p[1]! + (p[3]! - p[1]!) * t];
        out.push([...(from <= 0 ? [p[0]!, p[1]!] : pt(t0)), ...(to >= seg.len ? [p[2]!, p[3]!] : pt(t1))]);
      } else {
        const t0 = from <= 0 ? 0 : cubicParam(seg, from);
        const t1 = to >= seg.len ? 1 : cubicParam(seg, to);
        out.push(subCubic(seg.p, t0, t1));
      }
    }
    s = segEnd;
  }
}

/** A loop from raw pieces `[x0 y0 … xN yN]` (lines of 4, cubics of 8), closing back to its start. */
export function loopOf(pieces: number[][], closeTo?: [number, number]): Loop {
  const segs = pieces.map((p) => makeSeg(p));
  const first = pieces[0];
  const start: [number, number] = first ? [first[0]!, first[1]!] : closeTo ?? [0, 0];
  const last = pieces[pieces.length - 1];
  if (last) {
    const [ex, ey] = [last[last.length - 2]!, last[last.length - 1]!];
    segs.push(makeSeg([ex, ey, start[0], start[1]], true));
  }
  return makeLoop(segs, start);
}

// ---- parsing ----

/** SVG operand count per command letter (Docs/format/03 §3.2). */
const ARITY: Record<string, number> = { M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, H: 1, V: 1, Z: 0 };

/**
 * A layer's commands `[c0, c1)` as closed loops, one per subpath, numbered from its first moveto
 * (06 §6.1). Relative commands are resolved, quadratics raised to cubics (exact), and every subpath
 * gets its closing lineto (08 §5.1). A subpath whose segments all vanish is kept, empty, so later
 * subpaths keep their numbers (08 §11.7).
 */
export function parseLoops(ops: string, argCounts: number[], args: number[], range: [number, number], offsets = argOffsets(argCounts)): Loop[] {
  const loops: Loop[] = [];
  let segs: Seg[] | undefined;
  let sx = 0, sy = 0, x = 0, y = 0;
  // The last cubic's second handle and the last quadratic's control, for S and T.
  let lastC: [number, number] | undefined;
  let lastQ: [number, number] | undefined;
  const close = () => {
    if (!segs) return;
    if (Math.hypot(x - sx, y - sy) > 0) segs.push(makeSeg([x, y, sx, sy], true));
    loops.push(makeLoop(segs, [sx, sy]));
    segs = undefined;
    x = sx;
    y = sy;
  };
  const open = () => {
    if (!segs) {
      segs = [];
      sx = x;
      sy = y;
    }
  };
  for (let i = range[0]; i < range[1]; i++) {
    const op = ops[i]!;
    const n = argCounts[i] ?? 0;
    const base = offsets[i] ?? 0;
    const up = op.toUpperCase();
    const rel = op !== up;
    const arity = ARITY[up];
    if (arity === undefined) continue;
    if (up === "Z") {
      close();
      lastC = lastQ = undefined;
      continue;
    }
    for (let j = 0; j + arity <= n; j += arity) {
      const a = (k: number) => args[base + j + k]!;
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let c: [number, number] | undefined;
      let q: [number, number] | undefined;
      if (up === "M" && j === 0) {
        close();
        x = ox + a(0);
        y = oy + a(1);
        segs = [];
        sx = x;
        sy = y;
      } else {
        open();
        let p: number[];
        switch (up) {
          case "M":
          case "L":
          case "T":
          case "H":
          case "V": {
            let nx = x, ny = y;
            if (up === "H") nx = ox + a(0);
            else if (up === "V") ny = oy + a(0);
            else {
              nx = ox + a(0);
              ny = oy + a(1);
            }
            if (up === "T") {
              const [qx, qy] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
              q = [qx, qy];
              p = [x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny];
            } else p = [x, y, nx, ny];
            x = nx;
            y = ny;
            break;
          }
          case "C": {
            p = [x, y, ox + a(0), oy + a(1), ox + a(2), oy + a(3), ox + a(4), oy + a(5)];
            c = [p[4]!, p[5]!];
            x = p[6]!;
            y = p[7]!;
            break;
          }
          case "S": {
            const [hx, hy] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
            p = [x, y, hx, hy, ox + a(0), oy + a(1), ox + a(2), oy + a(3)];
            c = [p[4]!, p[5]!];
            x = p[6]!;
            y = p[7]!;
            break;
          }
          default: {
            // Q
            const qx = ox + a(0), qy = oy + a(1), nx = ox + a(2), ny = oy + a(3);
            q = [qx, qy];
            p = [x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny];
            x = nx;
            y = ny;
          }
        }
        segs!.push(makeSeg(p));
      }
      lastC = c;
      lastQ = q;
    }
  }
  close();
  return loops;
}

/** An affine image of a loop (08 §11.7: a rider's transform acts before the clip). */
export function transformLoop(loop: Loop, m: Matrix6): Loop {
  const map = (p: number[]) => {
    const out = new Array<number>(p.length);
    for (let i = 0; i < p.length; i += 2) {
      out[i] = m[0] * p[i]! + m[2] * p[i + 1]! + m[4];
      out[i + 1] = m[1] * p[i]! + m[3] * p[i + 1]! + m[5];
    }
    return out;
  };
  const [sx, sy] = loop.start;
  const start: [number, number] = [m[0] * sx + m[2] * sy + m[4], m[1] * sx + m[3] * sy + m[5]];
  return makeLoop(
    loop.segs.map((s) => makeSeg(map(s.p), s.closing)),
    start,
  );
}

// ---- writing ----

/** Appends commands to a `d` string, numbers as core's `serializePath` writes them (3 decimals). */
export class PathWriter {
  d = "";
  private num(v: number[], from: number): string {
    let s = "";
    for (let i = from; i < v.length; i++) s += (i > from ? " " : "") + formatNumber(v[i]!);
    return s;
  }
  move(x: number, y: number): void {
    this.d += `M${formatNumber(x)} ${formatNumber(y)}`;
  }
  line(x: number, y: number): void {
    this.d += `L${formatNumber(x)} ${formatNumber(y)}`;
  }
  /** A piece `[x0 y0 …]`: a line or a cubic, its start point implied. */
  piece(p: number[]): void {
    this.d += (p.length === 4 ? "L" : "C") + this.num(p, 2);
  }
  close(): void {
    this.d += "Z";
  }
}

/** A loop emitted whole from its own segments, its closing lineto written as `Z` (08 §6.3 step 5). */
export function writeWhole(loop: Loop, w: PathWriter): void {
  if (loop.segs.length === 0) return;
  w.move(loop.start[0], loop.start[1]);
  const n = loop.segs.length;
  for (let i = 0; i < n; i++) {
    const s = loop.segs[i]!;
    if (i === n - 1 && s.closing) break;
    w.piece(s.p);
  }
  w.close();
}

export { endPoint };
