import { argOffsets, serializePath } from "@opensymbols/core";
import type { StrokeKeyframe } from "../drawing.js";
import type { Matrix } from "../spec.js";
import { extract, loopOf, parseLoops, PathWriter, pointAt, tangentAt, transformLoop, wrap, writeWhole, type Loop } from "./length.js";
import { buildContours, EPS, field, REC, type CapShape, type Contour, type Field, type Rec } from "./progress.js";

/** 08 §7.2: κ = 0.5522847498 (`0x3FE1AC51114F0EAF`). */
const KAPPA = 0.5522847498;

/** 08 §10 whole-clip flags the model uses: the rider's tip run passes `noRemove | noEndcaps` (08 §11.3). */
export interface ClipFlags {
  noRemove?: boolean;
  noEndcaps?: boolean;
}

/** A cap the clipper passed: exit `E` at `exit`, the next entry `P` at `entry` (08 §11.3 `record_cap`). */
export interface CapRecord {
  contour: Contour;
  exit: number;
  entry: number;
  E: [number, number];
  P: [number, number];
}

// ---- the prepared outline, cached per layer ----

interface Prepared {
  loops: Loop[];
  contours: Contour[];
}

/** Keyed on the identity of `args` (and of the keyframes): both must be treated as immutable. */
const cache = new WeakMap<number[], Map<string, WeakMap<StrokeKeyframe[], Prepared>>>();

/** The layer's loops and contours; cached on the `args` array, the command range and the keyframes. */
export function prepare(ops: string, argCounts: number[], args: number[], range: [number, number], kfs: StrokeKeyframe[]): Prepared {
  let byRange = cache.get(args);
  if (!byRange) cache.set(args, (byRange = new Map()));
  const key = `${ops.length}:${range[0]}:${range[1]}`;
  let byKf = byRange.get(key);
  if (!byKf) byRange.set(key, (byKf = new WeakMap()));
  let p = byKf.get(kfs);
  if (!p) {
    const loops = parseLoops(ops, argCounts, args, range, argOffsets(argCounts));
    p = { loops, contours: buildContours(loops, kfs) };
    byKf.set(kfs, p);
  }
  return p;
}

/** The contours with per-subpath transforms applied before the clip (08 §11.7). */
export function contoursWith(p: Prepared, kfs: StrokeKeyframe[], transforms?: ReadonlyArray<{ subpath: number; transform: Matrix }>): Contour[] {
  if (!transforms || transforms.length === 0) return p.contours;
  const loops = p.loops.slice();
  let changed = false;
  for (const { subpath, transform } of transforms) {
    const l = loops[subpath];
    if (!l) continue;
    loops[subpath] = transformLoop(l, transform);
    changed = true;
  }
  return changed ? buildContours(loops, kfs) : p.contours;
}

// ---- 08 §8, §9: splitting a contour before the plain clip ----

const signed = (x: number): number => x - Math.round(x);

/**
 * 08 §8 `BisectState::cut_range`: the outline `a → b` (forward) closed by its chord. A record survives
 * when its points lie on the arc; with `partial` (bisection) one with a single point on it is kept
 * as a degenerate record there [INF]. `clear` is removed from `cut`'s flags.
 */
function cutRange(c: Contour, a: number, b: number, cut: Rec, clear: number, partial: boolean): Contour | undefined {
  const L = c.loop.length;
  const arc = wrap(b - a, L);
  if (!(arc > 1e-9)) return undefined;
  const pieces: number[][] = [];
  extract(c.loop, a, a + arc, pieces);
  if (pieces.length === 0) return undefined;
  const loop = loopOf(pieces);
  const tol = 1e-9 * Math.max(L, 1);
  const rel = (s: number) => {
    const x = wrap(s - a, L);
    return L - x < tol ? 0 : x;
  };
  const on = (x: number) => x <= arc + tol;
  const recs: Rec[] = [];
  for (const r of c.recs) {
    const x0 = Math.min(rel(r.s0), arc);
    const x1 = Math.min(rel(r.s1), arc);
    const flags = r === cut ? r.flags & ~clear : r.flags;
    const in0 = on(rel(r.s0));
    const in1 = on(rel(r.s1));
    if (in0 && in1) recs.push({ ...r, flags, s0: x0, s1: x1 });
    else if (partial && (in0 || in1)) {
      const x = in0 ? x0 : x1;
      recs.push({ ...r, flags: flags & ~clear, s0: x, s1: x });
    }
  }
  const out: Contour = { loop, recs, sources: c.sources };
  if (c.capStart) out.capStart = c.capStart;
  if (c.capEnd) out.capEnd = c.capEnd;
  return out;
}

/** The record's points ordered so the forward arc `a → b` is the shorter (Δ wrapped into [−0.5, 0.5], Δ ≥ 0 → a = s0). */
function shorter(r: Rec, L: number): [number, number] {
  return signed((r.s1 - r.s0) / L) >= 0 ? [r.s0, r.s1] : [r.s1, r.s0];
}

/** 08 §6.2: bisection records first (§8), then corner records (§9); the pieces for the plain clip, in order. */
export function expand(c: Contour, lo: number, hi: number, out: Contour[]): void {
  const k = c.recs.findIndex((r) => r.flags & REC.bisection);
  if (k < 0 || !(c.loop.length > 0)) {
    corners(c, lo, hi, out);
    return;
  }
  const r = c.recs[k]!;
  const [a, b] = shorter(r, c.loop.length);
  for (const half of [cutRange(c, a, b, r, REC.bisection, true), cutRange(c, b, a, r, REC.bisection, true)]) {
    if (half) expand(half, lo, hi, out);
  }
}

const between = (v: number, p: number, q: number) => v > Math.min(p, q) && v < Math.max(p, q);

/** 08 §9 `emit_corners`. */
function corners(c: Contour, lo: number, hi: number, out: Contour[]): void {
  for (let guard = 0; guard < 64; guard++) {
    const recs = c.recs;
    const L = c.loop.length;
    // Not the first nor the last; lo or hi between the progresses of the neighbouring records [INF strict].
    const i = recs.findIndex(
      (r, j) => r.flags & REC.corner && j !== 0 && j + 1 !== recs.length && (between(lo, recs[j - 1]!.progress, recs[j + 1]!.progress) || between(hi, recs[j - 1]!.progress, recs[j + 1]!.progress)),
    );
    if (i < 0 || !(L > 0)) break;
    const r = recs[i]!;
    const [a, b] = shorter(r, L);
    // The partner of the nearest keyframe point before a, and after b (distances wrapped into ±0.5).
    let before: { d: number; partner: number } | undefined;
    let after: { d: number; partner: number } | undefined;
    recs.forEach((o, j) => {
      if (j === i) return;
      for (const [s, partner] of [[o.s0, o.s1], [o.s1, o.s0]] as const) {
        const da = signed((s - a) / L);
        if (da < 0 && (!before || da > before.d)) before = { d: da, partner };
        const db = signed((s - b) / L);
        if (db > 0 && (!after || db < after.d)) after = { d: db, partner };
      }
    });
    if (!before || !after) {
      // Cannot split: the flag is ignored.
      c = { ...c, recs: recs.map((o) => (o === r ? { ...o, flags: o.flags & ~REC.corner } : o)) };
      continue;
    }
    const one = cutRange(c, before.partner, b, r, REC.corner, false);
    if (one) out.push(one);
    const two = cutRange(c, a, after.partner, r, REC.corner, false);
    if (!two) {
      // [INF] 08 §9 does not cover a degenerate piece 2 (vb at a: cut_range(a, vb) is empty). Piece 1
      // already holds va → b, so what is left of the outline is b → va, closed by its chord; it
      // continues in place of the subpath. Pushing `c` itself would draw va → b twice.
      const rest = cutRange(c, b, before.partner, r, REC.corner, false);
      if (!rest) return;
      c = rest;
      continue;
    }
    c = two;
  }
  out.push(c);
}

// ---- 08 §6.3: which part is kept ----

interface Arc {
  entry: number;
  /** Unwrapped: `entry < exit ≤ entry + length`. */
  exit: number;
  /** Arc lengths between the single keyframes around the entry and the exit (08 §7.1 "interval"). */
  entryInterval: number;
  exitInterval: number;
  /** The field's progress at the exit (08 §7.3 attributes the cut by it). */
  exitProgress: number;
}

interface Bounds {
  lo: number;
  hi: number;
  loOn: boolean;
  hiOn: boolean;
  loC: number;
  hiC: number;
}

/** 08 §6.3 steps 2–3: a bound at a progress extreme is off; one that is on is clamped to [kfMin, kfMax]. */
function bounds(f: Field, lo: number, hi: number): Bounds {
  const loOn = f.kfMin === 0 ? !(Math.abs(lo) < EPS) : !(lo < f.kfMin + EPS);
  const hiOn = f.kfMax === 1 ? !(Math.abs(hi - 1) < EPS) : !(hi > f.kfMax - EPS);
  const clamp = (v: number) => Math.min(Math.max(v, f.kfMin), f.kfMax);
  return { lo, hi, loOn, hiOn, loC: clamp(lo), hiC: clamp(hi) };
}

/** 08 §6.3 step 4–5: the kept arcs, cyclic, or the whole contour, or nothing. */
function keptArcs(c: Contour, f: Field, b: Bounds): Arc[] | "whole" | "none" {
  if (!b.loOn && !b.hiOn) return "whole";
  const L = c.loop.length;
  const S = f.singles;
  const m = S.length;
  const base = S[0]!.s;
  const iv: Array<{ a: number; b: number; ia: number; ib: number; pb: number }> = [];
  for (let k = 0; k < m; k++) {
    const A = S[k]!;
    const B = S[(k + 1) % m]!;
    const s0 = A.s;
    const s1 = k + 1 < m ? B.s : B.s + L;
    const len = s1 - s0;
    if (!(len > 0)) continue;
    let u0 = 0;
    let u1 = 1;
    const p0 = A.p;
    const dp = B.p - A.p;
    if (dp === 0) {
      if ((b.loOn && !(p0 > b.loC)) || (b.hiOn && !(p0 < b.hiC))) continue;
    } else {
      if (b.loOn) {
        const u = (b.loC - p0) / dp;
        if (dp > 0) u0 = Math.max(u0, u);
        else u1 = Math.min(u1, u);
      }
      if (b.hiOn) {
        const u = (b.hiC - p0) / dp;
        if (dp > 0) u1 = Math.min(u1, u);
        else u0 = Math.max(u0, u);
      }
      if (!(u1 - u0 > 1e-12)) continue;
    }
    const sa = s0 + u0 * len;
    const sb = s0 + u1 * len;
    const pb = p0 + u1 * dp;
    const last = iv[iv.length - 1];
    if (last && sa - last.b <= 1e-9) {
      last.b = sb;
      last.ib = len;
      last.pb = pb;
    } else iv.push({ a: sa, b: sb, ia: len, ib: len, pb });
  }
  if (iv.length === 0) return "none";
  const first = iv[0]!;
  const last = iv[iv.length - 1]!;
  if (iv.length > 1 && first.a - base <= 1e-9 && base + L - last.b <= 1e-9) {
    // The walk is cyclic: an arc running past the end continues from the start.
    last.b = first.b + L;
    last.ib = first.ib;
    last.pb = first.pb;
    iv.shift();
  }
  if (iv.length === 1 && iv[0]!.b - iv[0]!.a >= L - 1e-9) return "whole";
  return iv
    .filter((x) => x.b - x.a > 1e-9)
    .map((x) => ({ entry: wrap(x.a, L), exit: wrap(x.a, L) + (x.b - x.a), entryInterval: x.ia, exitInterval: x.ib, exitProgress: x.pb }))
    .sort((p, q) => p.entry - q.entry);
}

// ---- 08 §7: caps ----

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mulv = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
/** A move shorter than 08 §5.1's dropped segment (`length² ≤ 1e-8`) writes no lineto. */
const same = (a: V, b: V) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= 1e-8;

/** 08 §7.4: the recorded shape through the similarity taking its chord `c0 → cN` onto `E' → P'`. */
function replay(shape: CapShape, E: V, P: V, w: PathWriter): boolean {
  const v = sub(shape.cN, shape.c0);
  const t = sub(P, E);
  const lv = Math.hypot(v[0], v[1]);
  if (!(lv > 1e-9)) return false;
  const k = Math.hypot(t[0], t[1]) / lv;
  const th = Math.atan2(t[1], t[0]) - Math.atan2(v[1], v[0]);
  const cs = Math.cos(th) * k;
  const sn = Math.sin(th) * k;
  for (const p of shape.pieces) {
    const q = new Array<number>(p.length);
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i]! - shape.c0[0];
      const y = p[i + 1]! - shape.c0[1];
      q[i] = E[0] + cs * x - sn * y;
      q[i + 1] = E[1] + sn * x + cs * y;
    }
    w.piece(q);
  }
  return true;
}

/** 08 §7.2 kind 0, round: two cubics through the apex. */
function roundCap(E: V, P: V, dir: V, w: PathWriter): void {
  const chord = sub(P, E);
  const l = Math.hypot(chord[0], chord[1]);
  if (!(l > 1e-12)) return;
  const r = l / 2;
  const u = mulv(chord, 1 / l);
  const A = add(mulv(add(E, P), 0.5), mulv(dir, r));
  const kr = KAPPA * r;
  w.piece([E[0], E[1], ...add(E, mulv(dir, kr)), ...sub(A, mulv(u, kr)), ...A]);
  w.piece([A[0], A[1], ...add(A, mulv(u, kr)), ...add(P, mulv(dir, kr)), ...P]);
}

interface CapContext {
  c: Contour;
  f: Field;
  b: Bounds;
  flags: ClipFlags;
  caps?: CapRecord[];
}

/** 08 §7: from the exit of `arc` to the entry of `next`. */
function cap(ctx: CapContext, arc: Arc, next: Arc, w: PathWriter): void {
  const { c, f, b } = ctx;
  const loop = c.loop;
  const E = pointAt(loop, arc.exit);
  const P = pointAt(loop, next.entry);
  ctx.caps?.push({ contour: c, exit: wrap(arc.exit, loop.length), entry: next.entry, E, P });
  // 08 §7.5: noEndcaps → a bare lineto(P), before any squaring.
  if (ctx.flags.noEndcaps) {
    w.line(P[0], P[1]);
    return;
  }
  const uE = tangentAt(loop, arc.exit, true);
  const tP = tangentAt(loop, next.entry, false);
  const uP: V = [-tP[0], -tP[1]];
  // 08 §7.1: uE when the keyframe interval at P is shorter than the one at E, else uP.
  const dir = next.entryInterval < arc.exitInterval ? uE : uP;
  const q = dot(sub(P, E), dir);
  let E2: V = E;
  let P2: V = P;
  if (q <= 0) P2 = sub(P, mulv(dir, q));
  else E2 = add(E, mulv(dir, q));
  // 08 §7.3 [INF]: the cut is hi's when hi is on and E's progress is at least as close to it as to lo.
  const pE = arc.exitProgress;
  const isHi = b.hiOn && (!b.loOn || Math.abs(pE - b.hiC) <= Math.abs(pE - b.loC));
  let x = 0;
  if (isHi && b.hiC >= 1 && b.hi - b.hiC > EPS) x = b.hi - b.hiC;
  else if (!isHi && b.loOn && b.loC <= 0 && b.loC - b.lo > EPS) x = b.loC - b.lo;
  if (x > 0) {
    const n = add(uE, uP);
    const ln = Math.hypot(n[0], n[1]);
    if (ln > 1e-12) {
      const d = mulv(n, (f.speed * x) / ln);
      E2 = add(E2, d);
      P2 = add(P2, d);
    }
  }
  if (!same(E2, E)) w.line(E2[0], E2[1]);
  // 08 §7.4: the lo cut uses the start cap (when lo ≠ 0), the hi cut the end cap (when hi ≠ 1).
  const shape = isHi ? (b.hi !== 1 ? c.capEnd : undefined) : b.lo !== 0 ? c.capStart : undefined;
  if (!(shape && replay(shape, E2, P2, w))) roundCap(E2, P2, dir, w);
  if (!same(P2, P)) w.line(P[0], P[1]);
}

/** The plain clip of one piece (08 §6.3–§7). */
function clipPiece(c: Contour, lo: number, hi: number, flags: ClipFlags, w: PathWriter, caps?: CapRecord[]): void {
  if (!(c.loop.length > 0)) return;
  if (c.recs.length === 0) {
    writeWhole(c.loop, w);
    return;
  }
  const f = field(c);
  // 08 §6.3 step 1 (noRemove: ≤, 08 §10).
  const a = Math.max(lo, f.kfMin);
  const z = Math.min(hi, f.kfMax);
  if (!(flags.noRemove ? a <= z : a < z)) return;
  const b = bounds(f, lo, hi);
  const arcs = keptArcs(c, f, b);
  if (arcs === "none") return;
  if (arcs === "whole") {
    writeWhole(c.loop, w);
    return;
  }
  const ctx: CapContext = { c, f, b, flags };
  if (caps) ctx.caps = caps;
  const first = pointAt(c.loop, arcs[0]!.entry);
  w.move(first[0], first[1]);
  const pieces: number[][] = [];
  arcs.forEach((arc, i) => {
    pieces.length = 0;
    extract(c.loop, arc.entry, arc.exit, pieces);
    for (const p of pieces) w.piece(p);
    cap(ctx, arc, arcs[(i + 1) % arcs.length]!, w);
  });
  w.close();
}

/** Every contour cut to `[lo, hi]` (08 §6.1 "otherwise"): un-keyframed ones replayed whole. */
export function clipContours(contours: Contour[], lo: number, hi: number, flags: ClipFlags, w: PathWriter, caps?: CapRecord[]): void {
  const pieces: Contour[] = [];
  for (const c of contours) {
    if (c.recs.length === 0) {
      writeWhole(c.loop, w);
      continue;
    }
    pieces.length = 0;
    expand(c, lo, hi, pieces);
    for (const p of pieces) clipPiece(p, lo, hi, flags, w, caps);
  }
}

/**
 * The layer's outline cut to the stroke range `[start, end]` (Docs/format/08), as a path `d` in
 * path space. `ops`, `argCounts`, `args` and `range` are as `serializePath`'s; numbers are written
 * the same way (3 decimals). `subpathTransforms` (riders, 08 §11.7) act on their subpaths first.
 *
 * 08 §6.1: `[0, 1]` exactly with no subpath transform is the path untouched; `end ≤ 0`, `start ≥ 1`
 * or `end ≤ start` is empty (un-keyframed subpaths included). Deterministic; the parsed outline is
 * cached per `args` array (which must not be mutated). With subpath transforms, the transformed
 * loops are re-measured and the contours rebuilt from them (a joined pair is re-measured too);
 * untransformed loops are reused as measured.
 */
export function clipOutline(
  ops: string,
  argCounts: number[],
  args: number[],
  range: [number, number],
  strokeKeyframes: StrokeKeyframe[],
  start: number,
  end: number,
  subpathTransforms?: ReadonlyArray<{ subpath: number; transform: Matrix }>,
): string {
  const lo = start;
  const hi = end;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "";
  const moved = subpathTransforms !== undefined && subpathTransforms.length > 0;
  if (lo === 0 && hi === 1 && !moved) return serializePath(ops, argCounts, args, range);
  if (hi <= 0 || lo >= 1 || hi <= lo) return "";
  const p = prepare(ops, argCounts, args, range, strokeKeyframes);
  const w = new PathWriter();
  clipContours(contoursWith(p, strokeKeyframes, subpathTransforms), lo, hi, {}, w);
  return w.d;
}

/** 08 §3: the layer's `L_path` in path units, the largest speed over its (joined) subpaths; 0 without keyframes. */
export function strokeLength(path: { ops: string; argCounts: number[]; args: number[] }, strokeKeyframes: StrokeKeyframe[]): number {
  if (strokeKeyframes.length === 0) return 0;
  const p = prepare(path.ops, path.argCounts, path.args, [0, path.ops.length], strokeKeyframes);
  let v = 0;
  for (const c of p.contours) if (c.recs.length > 0) v = Math.max(v, field(c).speed);
  return Number.isFinite(v) ? v : 0;
}
