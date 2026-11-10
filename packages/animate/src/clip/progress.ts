import type { StrokeKeyframe } from "../drawing.js";
import { extract, loopOf, pointAt, wrap, type Loop } from "./length.js";

/** 08 §10 per-record flags (06 §6.1). */
export const REC = { corner: 1, lineCap: 2, invertJoined: 4, bisection: 8 } as const;

/** 08 §5.3: `|Δp| ≥ 1e-4` counts toward the speed (float32 `9.9999997e-05`, 07 §2.8). */
export const EPS = Math.fround(1e-4);

/** A record placed on a contour: its two points as arc positions in `[0, length]`. */
export interface Rec {
  /** Index into the layer's `strokeKeyframes`, kept through joins and splits (riders track it, 08 §11.3). */
  id: number;
  flags: number;
  progress: number;
  s0: number;
  s1: number;
}

/** A recorded cap shape (08 §7.4): the outline from `c0` to `cN`, as pieces. */
export interface CapShape {
  pieces: number[][];
  c0: [number, number];
  cN: [number, number];
}

/** A closed outline with the records that cut it. */
export interface Contour {
  loop: Loop;
  recs: Rec[];
  /** The layer subpaths it came from (one, or a joined pair, 08 §4). */
  sources: number[];
  /** 08 §7.4, computed once per (joined) subpath, inherited by its pieces. */
  capStart?: CapShape;
  capEnd?: CapShape;
}

/** One point of a record, as the field sees it (08 §5.1). */
export interface Single {
  s: number;
  p: number;
  /** Index into the contour's `recs`. */
  rec: number;
}

export interface Field {
  singles: Single[];
  kfMin: number;
  kfMax: number;
  /** 08 §5.3, the arc length the tip covers per unit of progress. */
  speed: number;
}

const frac = (d: number): number => d - Math.floor(d);

/** 08 §5.1: two single keyframes per record, sorted by arc position (stable). */
export function field(c: Contour): Field {
  const singles: Single[] = [];
  let kfMin = Infinity;
  let kfMax = -Infinity;
  c.recs.forEach((r, i) => {
    singles.push({ s: r.s0, p: r.progress, rec: i }, { s: r.s1, p: r.progress, rec: i });
    kfMin = Math.min(kfMin, r.progress);
    kfMax = Math.max(kfMax, r.progress);
  });
  singles.sort((a, b) => a.s - b.s);
  // 08 §5.3: Σ|Δs| / Σ|Δp| over consecutive single keyframes with |Δp| ≥ 1e-4, the wrapping pair included [INF].
  let ds = 0;
  let dp = 0;
  const n = singles.length;
  for (let k = 0; k < n && n > 1; k++) {
    const a = singles[k]!;
    const b = singles[(k + 1) % n]!;
    const step = Math.abs(b.p - a.p);
    if (step < EPS) continue;
    ds += Math.abs(k + 1 < n ? b.s - a.s : b.s + c.loop.length - a.s);
    dp += step;
  }
  return { singles, kfMin, kfMax, speed: dp > 0 ? ds / dp : 0 };
}

/**
 * 08 §7.4: the outline arc between a lineCap record's two points holding no other keyframe
 * position: with `a < b`, `a → b` unless some other record has a point in `[a, b)`, then `b → a`
 * wrapping.
 */
function capShape(c: Contour, r: Rec): CapShape | undefined {
  const a = Math.min(r.s0, r.s1);
  const b = Math.max(r.s0, r.s1);
  const L = c.loop.length;
  const blocked = c.recs.some((o) => o !== r && [o.s0, o.s1].some((s) => s >= a && s < b));
  const [from, to] = blocked ? [b, a + L] : [a, b];
  if (!(to - from > 1e-9)) return undefined;
  const pieces: number[][] = [];
  extract(c.loop, from, to, pieces);
  if (pieces.length === 0) return undefined;
  return { pieces, c0: pointAt(c.loop, from), cN: pointAt(c.loop, to) };
}

/** 08 §7.4: start cap = the lineCap record of lowest progress, end cap = of highest (first of equals). */
function withCaps(c: Contour): Contour {
  let lowest: Rec | undefined;
  let highest: Rec | undefined;
  for (const r of c.recs) {
    if (!(r.flags & REC.lineCap)) continue;
    if (!lowest || r.progress < lowest.progress) lowest = r;
    if (!highest || r.progress > highest.progress) highest = r;
  }
  if (lowest) {
    const s = capShape(c, lowest);
    if (s) c.capStart = s;
  }
  if (highest) {
    const s = capShape(c, highest);
    if (s) c.capEnd = s;
  }
  return c;
}

/** The loop rotated to start at position `s`. */
function rotated(loop: Loop, s: number): number[][] {
  const out: number[][] = [];
  extract(loop, s, s + loop.length, out);
  return out;
}

/**
 * The layer's contours (08 §4, §5.1): records go to the subpath `floor(d0)`; a compound record
 * on adjacent subpaths `(i, i+1)` joins them into one contour slit at its seam (the compound
 * record of lowest progress). A chain joins only its first pair; a compound record on non-adjacent
 * subpaths, or whose other point is off its contour, is dropped [INF].
 */
export function buildContours(loops: Loop[], kfs: StrokeKeyframe[]): Contour[] {
  const n = loops.length;
  const valid = (d: number) => Number.isFinite(d) && d >= 0 && Math.floor(d) < n;
  const recs = kfs.map((k, id) => ({ k, id, i0: Math.floor(k.d0), i1: Math.floor(k.d1) })).filter((r) => valid(r.k.d0) && valid(r.k.d1));

  // Which pairs join: ascending, a subpath joins at most once.
  const joinedWith = new Map<number, number>();
  const pairs = [...new Set(recs.filter((r) => Math.abs(r.i0 - r.i1) === 1).map((r) => Math.min(r.i0, r.i1)))].sort((a, b) => a - b);
  for (const i of pairs) {
    if (joinedWith.has(i) || joinedWith.has(i + 1)) continue;
    joinedWith.set(i, i + 1);
    joinedWith.set(i + 1, i);
  }

  const out: Contour[] = [];
  for (let i = 0; i < n; i++) {
    const j = joinedWith.get(i);
    if (j !== undefined && j < i) continue;
    if (j === undefined) {
      const L = loops[i]!.length;
      const own = recs
        .filter((r) => r.i0 === i && r.i1 === i)
        .map((r) => ({ id: r.id, flags: r.k.flags, progress: r.k.progress, s0: frac(r.k.d0) * L, s1: frac(r.k.d1) * L }));
      out.push(withCaps({ loop: loops[i]!, recs: own, sources: [i] }));
    } else out.push(withCaps(join(loops, i, recs)));
  }
  return out;
}

interface RawRec {
  k: StrokeKeyframe;
  id: number;
  i0: number;
  i1: number;
}

/** 08 §4: subpaths `i` and `i + 1` as one contour, slit at the seam. */
function join(loops: Loop[], i: number, recs: RawRec[]): Contour {
  const A = loops[i]!;
  const B = loops[i + 1]!;
  const LA = A.length;
  const LB = B.length;
  const compound = recs.filter((r) => (r.i0 === i && r.i1 === i + 1) || (r.i0 === i + 1 && r.i1 === i));
  // 1. The seam: the compound record of lowest progress (first of equals).
  let seam = compound[0]!;
  for (const r of compound) if (r.k.progress < seam.k.progress) seam = r;
  const fOn = (r: RawRec, sub: number) => frac(r.i0 === sub ? r.k.d0 : r.k.d1);
  const sA = fOn(seam, i) * LA;
  const sB = fOn(seam, i + 1) * LB;
  const pa = pointAt(A, sA);
  const pb = pointAt(B, sB);

  // 2. i rotated to the seam, the jump, i+1 rotated to the seam, close (the jumps are straight, 08 §4 [INF]).
  const pieces = [...rotated(A, sA), [pa[0], pa[1], pb[0], pb[1]], ...rotated(B, sB)];
  const loop = loopOf(pieces, pa);
  const chord = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const baseB = LA + (chord > 1e-4 ? chord : 0);

  // 4. Every record re-mapped into the joined contour's arc length.
  const tol = 1e-9 * Math.max(LA + LB, 1);
  type Pt = { sub: number; x: number; seam: boolean };
  const place = (d: number, sub: number): Pt => {
    const L = sub === i ? LA : LB;
    const s0 = sub === i ? sA : sB;
    const x = wrap(frac(d) * L - s0, L);
    return { sub, x, seam: x < tol || L - x < tol };
  };
  const ordered = [
    ...recs.filter((r) => r.i0 === i && r.i1 === i),
    ...recs.filter((r) => r.i0 === i + 1 && r.i1 === i + 1),
    ...compound,
  ];
  const placed = ordered.map((r) => ({ r, a: place(r.k.d0, r.i0), b: place(r.k.d1, r.i1) }));
  const pos = (p: Pt, at: "start" | "end") => (p.sub === i ? (at === "start" ? 0 : LA) : baseB + (at === "start" ? 0 : LB));

  // [INF] A seam point goes to the end of its loop whose neighbouring keyframe progress it is closer
  // to; on a tie the first loop's start, the second loop's end.
  const neighbours = (sub: number) => {
    const xs = placed.flatMap(({ r, a, b }) => [a, b].filter((p) => p.sub === sub && !p.seam).map((p) => ({ x: p.x, p: r.k.progress })));
    xs.sort((u, v) => u.x - v.x);
    return { first: xs[0]?.p, last: xs[xs.length - 1]?.p };
  };
  const nb = [neighbours(i), neighbours(i + 1)];
  const seamPos = (p: Pt, progress: number): number => {
    const { first, last } = nb[p.sub === i ? 0 : 1]!;
    const dStart = first === undefined ? Infinity : Math.abs(progress - first);
    const dEnd = last === undefined ? Infinity : Math.abs(progress - last);
    if (dStart < dEnd) return pos(p, "start");
    if (dEnd < dStart) return pos(p, "end");
    return pos(p, p.sub === i ? "start" : "end");
  };
  const at = (p: Pt, progress: number) => (p.seam ? seamPos(p, progress) : (p.sub === i ? 0 : baseB) + p.x);
  const out: Rec[] = placed.map(({ r, a, b }) => ({ id: r.id, flags: r.k.flags, progress: r.k.progress, s0: at(a, r.k.progress), s1: at(b, r.k.progress) }));
  return { loop, recs: out, sources: [i, i + 1] };
}
