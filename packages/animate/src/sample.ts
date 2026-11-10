import { hasRiders, resolveRiders } from "./clip/riders.js";
import { curve } from "./curves.js";
import type { AnimDrawing, AnimLayer } from "./drawing.js";
import { BUILTIN_PLANS } from "./effects/index.js";
import { evalTrack, LAYER_FLAG, trackEnd, type Track } from "./keyframes.js";
import type { EffectKind, LayerState, Matrix, Spec } from "./spec.js";

/**
 * What an effect builds for one drawing and spec (Docs/format/07 §6.3 [INF]). Times are in
 * effect seconds (before `speed`).
 */
export interface Plan {
  /** Once: every track. Looping continuous: the intro over `[0, intro end]` (empty for Pulse, Breathe). */
  tracks: Track[];
  /** A continuous effect's loop: tracks timed from the start of each repetition. */
  loop?: { tracks: Track[]; period: number };
  /**
   * A looping effect's outro (07 §6.2 phase 2): tracks timed from the end of a group's last cycle,
   * played when the effect is stopped (07 §6.3). Absent: the group rests at its cycle end.
   */
  outro?: { tracks: Track[] };
  /** Per compacted group, a clock delay (07 §4.6); empty or absent when none. */
  groupDelay?: number[];
  /** A whole-clock warp over `[0, timeSpan]` on `timeCurve` (Draw `.individually`, 07 §7.8). */
  timeSpan?: number;
  timeCurve?: number;
  /** pulse-alpha's floor for a layer; 07 §7.2 default `0.30000001192092896`. */
  pulseFloor?: (layer: AnimLayer) => number;
  /** The upper clamp of a layer's alpha; 1 by default (07 §2.7). */
  alphaCap?: (layer: AnimLayer) => number;
  /**
   * The effect's own total (07 §5 `local_duration`) when it outlasts the tracks: a once effect's
   * `duration()` is the larger of the two (Replace 0.5, Magic Replace badge 1.0, 07 §7.9, §7.10).
   */
  total?: number;
}

export type PlanBuilder = (d: AnimDrawing, spec: Spec) => Plan;

// ---- the registry ----

const overrides = new Map<string, PlanBuilder>();

/**
 * Internal: installs `plan` for `kind`, ahead of the built-in table; returns the undo. The built-in
 * plans live in a static table (effects/index.ts) rather than registering themselves at import, so
 * the package stays free of import side effects (`sideEffects: false`).
 */
export function registerPlan(kind: EffectKind, plan: PlanBuilder): () => void {
  const previous = overrides.get(kind);
  overrides.set(kind, plan);
  cache = new WeakMap();
  return () => {
    if (overrides.get(kind) !== plan) return;
    if (previous) overrides.set(kind, previous);
    else overrides.delete(kind);
    cache = new WeakMap();
  };
}

function builderFor(kind: EffectKind): PlanBuilder {
  const b = overrides.get(kind) ?? (Object.hasOwn(BUILTIN_PLANS, kind) ? BUILTIN_PLANS[kind] : undefined);
  if (!b) throw new RangeError(`no plan for effect kind "${String(kind)}"`);
  return b;
}

/** Internal: the plan cache key. Every Spec field but `speed` (which only rescales time, 07 §6.4), sorted. */
export function specKey(s: Spec): string {
  return (Object.keys(s) as Array<keyof Spec>)
    .filter((k) => k !== "speed")
    .sort()
    .map((k) => `${k}=${String(s[k])}`)
    .join("|");
}

interface Built {
  plan: Plan;
  /** Latest track end of `plan.tracks`. */
  end: number;
  groups: number;
}

let cache = new WeakMap<AnimDrawing, Map<string, Built>>();

function build(d: AnimDrawing, spec: Spec): Built {
  checkSpeed(spec.speed);
  const key = specKey(spec);
  let perDrawing = cache.get(d);
  const hit = perDrawing?.get(key);
  if (hit) return hit;
  const built = wrap(builderFor(spec.kind)(d, spec), d, spec);
  if (!perDrawing) {
    perDrawing = new Map();
    cache.set(d, perDrawing);
  }
  // A small bound: a driver samples a handful of specs per drawing.
  if (perDrawing.size >= 16) perDrawing.clear();
  perDrawing.set(key, built);
  return built;
}

function wrap(plan: Plan, d: AnimDrawing, spec: Spec): Built {
  let end = 0;
  for (const t of plan.tracks) end = Math.max(end, trackEnd(t));
  return { plan, end, groups: spec.byLayer ? Math.max(d.groupCount, 1) : 1 };
}

/** Internal: a non-looping plan's span in effect seconds, the latest track end or its `total` (0 when neither). */
export function planSpan(plan: Plan): number {
  let end = plan.total !== undefined && Number.isFinite(plan.total) && plan.total > 0 ? plan.total : 0;
  for (const t of plan.tracks) end = Math.max(end, trackEnd(t));
  return end;
}

/** Internal: 07 §6.4, a speed that is not finite and > 0 is a RangeError. */
export function checkSpeed(speed: number): void {
  // 07 §6.4: a non-positive or non-finite speed is rejected, never clamped into a NaN.
  if (!(Number.isFinite(speed) && speed > 0)) throw new RangeError(`speed must be finite and > 0, got ${speed}`);
}

const looping = (p: Plan): p is Plan & { loop: { tracks: Track[]; period: number } } =>
  p.loop !== undefined && Number.isFinite(p.loop.period) && p.loop.period > 0;

/** The largest delay among the groups that exist. */
function maxDelay(b: Built): number {
  let m = 0;
  const gd = b.plan.groupDelay ?? [];
  for (let g = 0; g < b.groups; g++) m = Math.max(m, gd[g] ?? 0);
  return m;
}

/**
 * One cycle, in seconds (07 §6.3): the loop period for a looping continuous effect, else the latest
 * track end or the plan's `total` if longer (1.0 when neither, so a frame schedule stays sane),
 * divided by speed.
 */
export function duration(d: AnimDrawing, spec: Spec): number {
  const b = build(d, spec);
  const span = planSpan(b.plan);
  const base = looping(b.plan) ? b.plan.loop.period : span > 0 ? span : 1;
  return base / spec.speed;
}

/**
 * The first instant every group is looping (07 §6.3): intro + the largest group delay for a
 * looping continuous effect, else 0. From it on, `sample(t) == sample(t + duration())`.
 */
export function loopStart(d: AnimDrawing, spec: Spec): number {
  const b = build(d, spec);
  return looping(b.plan) ? (b.end + maxDelay(b)) / spec.speed : 0;
}

/** Per compacted group, in effect seconds: when its current cycle ends, and whether its clock had started. */
function groupCycleEnds(b: Built, te: number): { end: number; started: boolean }[] {
  const period = b.plan.loop!.period;
  const gd = b.plan.groupDelay ?? [];
  const out: { end: number; started: boolean }[] = [];
  for (let g = 0; g < b.groups; g++) {
    const delay = gd[g] ?? 0;
    const lt = te - delay;
    let end: number;
    if (lt <= 0) end = te;
    else if (lt <= b.end) end = delay + b.end;
    else end = delay + b.end + Math.ceil((lt - b.end) / period) * period;
    out.push({ end, started: lt > 0 });
  }
  return out;
}

/**
 * Internal (the React driver's stop, 07 §6.3 "Stopping a continuous effect" [INF]): for a looping
 * continuous effect stopped at `t` seconds, per compacted group, the time in seconds at which that
 * group's current cycle ends (the intro counts as its first cycle; a group whose clock has not
 * started yet ends at `t`). From then on the group plays the outro, if the plan has one, then
 * rests. Undefined when the plan does not loop.
 */
export function cycleEnds(d: AnimDrawing, spec: Spec, t: number): number[] | undefined {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  const b = build(d, spec);
  if (!looping(b.plan)) return undefined;
  return groupCycleEnds(b, Math.max(t, 0) * spec.speed).map((g) => g.end / spec.speed);
}

/** Internal: a looping effect stopped at some instant (`stopAt`), for `sampleStopped`. */
export interface Stop {
  /** Per compacted group, in effect seconds: its cycle end, and whether it plays the outro from there. */
  groups: { end: number; started: boolean }[];
  /** Seconds after the start at which every group rests. */
  end: number;
}

/**
 * Internal (07 §6.3 [INF]): stopping a looping continuous effect at `t` seconds. Each group finishes
 * its current cycle on its own delayed clock (`cycleEnds`), then plays the plan's outro from there
 * (Bounce, 07 §7.1), then rests. A group whose clock had not started rests at once. Undefined when
 * the plan does not loop.
 */
export function stopAt(d: AnimDrawing, spec: Spec, t: number): Stop | undefined {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  const b = build(d, spec);
  if (!looping(b.plan)) return undefined;
  const te = Math.max(t, 0) * spec.speed;
  const groups = groupCycleEnds(b, te);
  let outroLen = 0;
  for (const tr of b.plan.outro?.tracks ?? []) outroLen = Math.max(outroLen, trackEnd(tr));
  let end = te;
  for (const g of groups) end = Math.max(end, g.end + (g.started ? outroLen : 0));
  return { groups, end: end / spec.speed };
}

/** Internal: every layer's state at `t` seconds of an effect stopped as `stop` says (07 §6.3 [INF]). */
export function sampleStopped(d: AnimDrawing, spec: Spec, stop: Stop, t: number): LayerState[] {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  return evaluate(d, build(d, spec), spec, t, stop);
}

// ---- sampling ----

/** Per-layer accumulator of the properties of 07 §2.3. */
interface Acc {
  alpha: number;
  hidden: boolean;
  scale: number;
  badgeScale: number;
  symbolTurn: number;
  layerTurn: number;
  /** Output-space offset, viewBox units. */
  ox: number;
  oy: number;
  strokeStart: number;
  strokeEnd: number;
  strokeClip: boolean;
  attachmentScale: number;
}

const fresh = (): Acc => ({
  alpha: 1,
  hidden: false,
  scale: 1,
  badgeScale: 1,
  symbolTurn: 0,
  layerTurn: 0,
  ox: 0,
  oy: 0,
  strokeStart: 0,
  strokeEnd: 1,
  strokeClip: false,
  attachmentScale: 1,
});

/** 07 §7.2: Pulse's default floor, float32 `0.30000001192092896`. */
const PULSE_FLOOR = Math.fround(0.3);

function applyTrack(acc: Acc, track: Track, layer: AnimLayer, v: number, plan: Plan, d: AnimDrawing): void {
  // 07 §2.3, one handler per property.
  switch (track.property) {
    case "alpha":
      acc.alpha *= v;
      break;
    case "scale":
      // An assignment in Apple; no effect gives a layer two scale lists, so the model folds a product [INF].
      acc.scale *= v;
      break;
    case "scaleInterpolant": {
      const [s, k] = track.interp ?? [1, 1];
      acc.scale *= s + (k - s) * v;
      break;
    }
    case "scaleBadge":
      acc.badgeScale = v;
      break;
    case "translation": {
      // 07 §2.6: v × point size, along dir, in output space.
      const [dx, dy] = track.dir ?? [0, 0];
      acc.ox += dx * v * d.pointSize;
      acc.oy += dy * v * d.pointSize;
      break;
    }
    case "symbolRotation":
      acc.symbolTurn += v;
      break;
    case "layerRotation":
      acc.layerTurn += v;
      break;
    case "pulseAlpha": {
      const floor = plan.pulseFloor ? plan.pulseFloor(layer) : PULSE_FLOOR;
      acc.alpha *= floor + (1 - floor) * v;
      break;
    }
    case "clipAlpha":
      acc.alpha *= v;
      if (v <= 0) acc.hidden = true;
      break;
    case "strokeStart":
      if (layer.strokable) {
        acc.strokeStart = v;
        acc.strokeClip = true;
      } else acc.alpha *= 1 - v;
      break;
    case "strokeEnd":
      if (layer.strokable) {
        acc.strokeEnd = v;
        acc.strokeClip = true;
      } else acc.alpha *= v;
      break;
    case "attachmentScale":
      acc.attachmentScale = v;
      break;
  }
}

// ---- matrices (SVG order [a b c d e f]) ----

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** `T(p) · L · T(−p)` for a linear part `L = [a b c d]`. */
const about = (a: number, b: number, c: number, dd: number, p: [number, number]): Matrix => [
  a,
  b,
  c,
  dd,
  p[0] - a * p[0] - c * p[1],
  p[1] - b * p[0] - dd * p[1],
];

/** 07 §2.6: rotation by θ in y-down space is `[cos θ, sin θ, −sin θ, cos θ]` (positive turns clockwise on screen). */
const rotateAbout = (theta: number, p: [number, number]): Matrix => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return about(c, s, -s, c, p);
};

const z = (v: number): number => (v === 0 ? 0 : v);

/**
 * 07 §2.5: point → S_badge(badge centre) → R_layer(anchor) → S(centre) → R_symbol(centre) → M →
 * + offset. In path space, before M: `T(o') · [T(c) R(symbolTurn) S(scale) T(−c)] · [T(a) R(layerTurn)
 * T(−a)] · [T(b) S(badge) T(−b)]`, with `o' = M_lin⁻¹ · offset` (M's translation commutes out).
 */
function compose(acc: Acc, d: AnimDrawing): Matrix {
  // A non-finite component is a plan bug: surface it rather than draw a NaN matrix.
  for (const k of ["badgeScale", "layerTurn", "scale", "symbolTurn", "ox", "oy"] as const) {
    if (!Number.isFinite(acc[k])) throw new RangeError(`non-finite ${k} (${acc[k]}) in a layer transform`);
  }
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (acc.badgeScale !== 1) m = about(acc.badgeScale, 0, 0, acc.badgeScale, d.badgeCenter);
  if (acc.layerTurn !== 0) m = mul(rotateAbout(acc.layerTurn, d.rotationAnchor), m);
  if (acc.scale !== 1 || acc.symbolTurn !== 0) {
    const c = Math.cos(acc.symbolTurn);
    const s = Math.sin(acc.symbolTurn);
    const k = acc.scale;
    // R(θ) · S(k) = [k cos, k sin, −k sin, k cos]
    m = mul(about(k * c, k * s, -k * s, k * c, d.metricCenter), m);
  }
  if (acc.ox !== 0 || acc.oy !== 0) {
    const [a, b, c, dd] = d.transform;
    const det = a * dd - b * c;
    if (det !== 0 && Number.isFinite(det)) {
      const px = (dd * acc.ox - c * acc.oy) / det;
      const py = (-b * acc.ox + a * acc.oy) / det;
      if (Number.isFinite(px) && Number.isFinite(py)) m = [m[0], m[1], m[2], m[3], m[4] + px, m[5] + py];
    }
  }
  return m.map(z) as Matrix;
}

function finish(acc: Acc, layer: AnimLayer, plan: Plan, d: AnimDrawing): LayerState {
  const cap = plan.alphaCap ? plan.alphaCap(layer) : 1;
  let alpha = Number.isFinite(acc.alpha) ? Math.min(Math.max(acc.alpha, 0), cap) : 0;
  if (acc.hidden) alpha = 0;
  const finite = (v: number, rest: number) => (Number.isFinite(v) ? v : rest);
  return {
    transform: compose(acc, d),
    alpha: z(alpha),
    visible: !acc.hidden && alpha > 0,
    strokeStart: finite(acc.strokeStart, 0),
    strokeEnd: finite(acc.strokeEnd, 1),
    strokeClip: acc.strokeClip,
    attachmentScale: finite(acc.attachmentScale, 1),
    subpathTransforms: [],
  };
}

/** Does `track` reach `layer` (07 §2.2: index mode and filter)? */
function admits(track: Track, layer: AnimLayer, index: number, group: number, flags: number): boolean {
  if (track.layer !== undefined && track.layer !== index) return false;
  if (track.group !== undefined && track.group !== group) return false;
  const f = track.filter;
  return !f || ((flags ^ f.value) & f.mask) === 0;
}

/**
 * Every layer's state at `t` seconds (07 §6.3). Pure: no clock, no DOM. `t < 0` is the start
 * state; past `duration()` a once effect holds its end state and a continuous one keeps looping.
 */
export function sample(d: AnimDrawing, spec: Spec, t: number): LayerState[] {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  return evaluate(d, build(d, spec), spec, t);
}

/**
 * Internal: `sample` for a plan built elsewhere — a Magic Replace pair, whose plan depends on both
 * drawings (07 §7.10). `spec` still gives the speed, the grouping and the Replace side.
 */
export function samplePlan(d: AnimDrawing, plan: Plan, spec: Spec, t: number): LayerState[] {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  checkSpeed(spec.speed);
  return evaluate(d, wrap(plan, d, spec), spec, t);
}

function evaluate(d: AnimDrawing, b: Built, spec: Spec, t: number, stop?: Stop): LayerState[] {
  const { plan } = b;
  // 07 §6.4: effect time.
  let te = t * spec.speed;
  if (!Number.isFinite(te)) throw new RangeError(`effect time t · speed overflows: ${t} · ${spec.speed}`);
  const loop = looping(plan) ? plan.loop : undefined;
  if (!loop && plan.timeSpan !== undefined && plan.timeSpan > 0) {
    // 07 §7.8: t' = total · curve(t / total) over [0, total].
    const span = plan.timeSpan;
    if (te > 0 && te < span) te = span * curve(plan.timeCurve ?? 0)(te / span);
  }
  // 07 §2.2: the side bit of a Replace pair.
  const side =
    spec.kind === "replace" || spec.kind === "magicReplace"
      ? spec.replaceHalf === "out"
        ? LAYER_FLAG.sourceSide
        : LAYER_FLAG.destinationSide
      : 0;
  const delays = plan.groupDelay ?? [];

  const states = d.layers.map((layer, i) => {
    const group = spec.byLayer ? layer.group : 0;
    const flags = layer.flags | (layer.clearBehind[spec.renderingMode] ? LAYER_FLAG.eraser : 0) | side;
    let tracks = plan.tracks;
    let at = te;
    const halt = stop?.groups[group];
    if (loop && halt && te >= halt.end) {
      // Stopped (07 §6.3 [INF]): past its cycle end the group plays the outro, then holds rest.
      tracks = halt.started ? (plan.outro?.tracks ?? []) : [];
      at = te - halt.end;
    } else if (loop) {
      // 07 §6.3: group g at max(t − delay, 0); intro over [0, end], then the loop modulo its period.
      const lt = Math.max(te - (delays[group] ?? 0), 0);
      if (lt >= b.end) {
        tracks = loop.tracks;
        at = (lt - b.end) % loop.period;
      } else at = lt;
    }
    const acc = fresh();
    for (const track of tracks) {
      if (!admits(track, layer, i, group, flags)) continue;
      applyTrack(acc, track, layer, evalTrack(track, at), plan, d);
    }
    return finish(acc, layer, plan, d);
  });
  // 08 §11.7: riders follow their target's final range, so they are resolved once every range is known.
  if (hasRiders(d) && states.some((s) => s.strokeClip)) resolveRiders(d, states);
  return states;
}
