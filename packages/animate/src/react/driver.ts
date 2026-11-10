import { formatSignificant, serializePath } from "@opensymbols/core";
import { clipOutline } from "../clip/cut.js";
import type { AnimDrawing, AnimLayer } from "../drawing.js";
import type { LayerState, Matrix } from "../spec.js";

/** One element a layer drives: its `<g data-layer>` (painted) or, for a knockout, the mask's `<path data-layer>`. */
interface LayerElement {
  el: Element;
  index: number;
  /** The path whose `d` a stroke clip replaces (the element itself for a mask path). */
  path: Element | null;
  /** The path's static `d`, computed the first time it is restored. */
  whole?: string;
  clipped: boolean;
}

/** One rendered `<svg>` and the drawing its layers were built from. */
export interface Target {
  svg: SVGSVGElement;
  drawing: AnimDrawing;
  /** Internal: the cached layer elements, and whether a render may have changed them (`invalidate`). */
  elements?: LayerElement[];
  stale?: boolean;
}

/** One animation on the shared loop. */
export interface Run {
  targets: Target[];
  /** The per-target layer states `t` seconds after the start. */
  sample: (t: number) => LayerState[][];
  /** Seconds after the start at which the run settles; Infinity runs until `end` is lowered. */
  end: number;
  /** Start, in the `performance.now()` / `requestAnimationFrame` timeline (ms). */
  t0: number;
  /** Called once, after the final state is written. Not called on `cancel`. */
  onEnd?: () => void;
  /** Set when the loop dropped the run (an error in a frame, or a detached `<svg>`): it never finished. */
  dropped?: boolean;
}

/** The identity state: what a layer looks like with no effect. */
export const REST: LayerState = {
  transform: [1, 0, 0, 1, 0, 0],
  alpha: 1,
  visible: true,
  strokeStart: 0,
  strokeEnd: 1,
  strokeClip: false,
  attachmentScale: 1,
  subpathTransforms: [],
};

// ---- the shared loop ----

/** Live runs (membership) and the order they are stepped in (compacted after each frame). */
const live = new Set<Run>();
const order: Run[] = [];
let frame: number | undefined;

export const now = (): number => performance.now();

/** `prefers-reduced-motion: reduce`, read when an effect starts: effects jump to their end state. */
export function reducedMotion(): boolean {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  return typeof mm === "function" && mm("(prefers-reduced-motion: reduce)").matches;
}

/** Internal (tests): how many runs the loop holds. */
export const liveRuns = (): number => live.size;

/** Whether `run` is still on the loop. */
export const isLive = (run: Run | undefined): boolean => run !== undefined && live.has(run);

/** Adds `run` to the loop and writes its first frame now (no blank frame before the first tick). */
export function start(run: Run): void {
  live.add(run);
  order.push(run);
  step(run, run.t0);
  schedule();
}

/** Takes `run` off the loop with no further write (unmount, or a newer run on the same icon). */
export function cancel(run: Run | undefined): void {
  if (!run) return;
  live.delete(run);
  if (live.size === 0) {
    order.length = 0;
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  }
}

function schedule(): void {
  if (frame === undefined && live.size > 0) frame = requestAnimationFrame(tick);
}

function tick(ts: number): void {
  frame = undefined;
  // Runs started during this frame (an `onEnd` resuming an effect) were written by `start`.
  const n = order.length;
  for (let k = 0; k < n; k++) step(order[k]!, ts);
  let w = 0;
  for (let k = 0; k < order.length; k++) {
    const r = order[k]!;
    if (live.has(r)) order[w++] = r;
  }
  order.length = w;
  schedule();
}

function step(run: Run, ts: number): void {
  if (!live.has(run)) return;
  // Review Focus 5: an icon unmounted without its cleanup (or detached) is dropped, never written.
  for (let k = 0; k < run.targets.length; k++) {
    if (!run.targets[k]!.svg.isConnected) {
      live.delete(run);
      run.dropped = true;
      return;
    }
  }
  try {
    const t = Math.max(0, (ts - run.t0) / 1000);
    if (t >= run.end) finish(run);
    else write(run.targets, run.sample(t), false);
  } catch (e) {
    // One bad run must not stop the others: drop it and report the error outside the loop.
    live.delete(run);
    run.dropped = true;
    queueMicrotask(() => {
      throw e;
    });
  }
}

/** Writes the run's final state, clearing the layers that end at rest, and calls `onEnd`. */
export function finish(run: Run): void {
  live.delete(run);
  write(run.targets, run.sample(run.end), true);
  run.onEnd?.();
}

// ---- writing a frame ----

const isIdentity = (m: Matrix): boolean =>
  Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9;

const atRest = (s: LayerState): boolean =>
  isIdentity(s.transform) && s.alpha >= 1 && s.visible && !s.strokeClip && s.subpathTransforms.length === 0;

/** `matrix(a b c d e f)`, 6 significant digits, never exponent notation (as the static transform). */
export const matrixAttr = (m: Matrix): string => `matrix(${m.map((n) => formatSignificant(n)).join(" ")})`;

function set(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * The target's layer elements, scoped to its own `<svg>` so two icons never touch each other's
 * masks (Review Focus 3). Cached; rebuilt after `invalidate` or when React replaced a node.
 */
function elementsOf(target: Target): LayerElement[] {
  const cached = target.elements;
  if (cached && !target.stale) {
    let ok = true;
    for (let k = 0; k < cached.length; k++) {
      if (!cached[k]!.el.isConnected) {
        ok = false;
        break;
      }
    }
    if (ok) return cached;
  }
  const out: LayerElement[] = [];
  for (const el of target.svg.querySelectorAll("[data-layer]")) {
    const path = el.tagName.toLowerCase() === "path" ? el : el.querySelector("path");
    // A node React kept keeps its clip flag; a node it replaced holds its static `d` again.
    const prior = path ? cached?.find((c) => c.path === path) : undefined;
    out.push({ el, index: Number(el.getAttribute("data-layer")), path, clipped: prior?.clipped ?? false });
  }
  target.elements = out;
  target.stale = false;
  return out;
}

/** After a render (or a new drawing): the next write re-reads the layer elements and their static `d`. */
export function invalidate(target: Target): void {
  target.stale = true;
}

function restoreD(e: LayerElement, layer: AnimLayer): void {
  if (!e.path || !e.clipped) return;
  e.whole ??= serializePath(layer.path.ops, layer.path.argCounts, layer.path.args, [0, layer.path.ops.length]);
  e.path.setAttribute("d", e.whole);
  e.clipped = false;
}

function clear(e: LayerElement, layer: AnimLayer): void {
  set(e.el, "transform", null);
  set(e.el, "opacity", null);
  set(e.el, "display", null);
  restoreD(e, layer);
}

/**
 * Writes `states[k]` to `targets[k]`. Per layer: `transform` (path space: the layer's element lives
 * inside the symbol's transformed group), `opacity` (the alpha; the static opacity stays on the
 * path), `display: none` when not visible, and the clipped `d` for a stroke-clipped layer. With
 * `settle`, a layer at rest is returned to its static markup.
 *
 * [INF] A knockout's mask copy follows its layer the same way, `opacity` included: a fading eraser
 * erases partly while it animates, though statically an eraser erases fully (Docs/format/07 §2.7).
 */
export function write(targets: Target[], states: LayerState[][], settle: boolean): void {
  for (let k = 0; k < targets.length; k++) {
    const target = targets[k]!;
    const layerStates = states[k];
    if (!layerStates) continue;
    const els = elementsOf(target);
    for (let j = 0; j < els.length; j++) {
      const e = els[j]!;
      const s = layerStates[e.index];
      const layer = target.drawing.layers[e.index];
      if (!s || !layer) continue;
      if (settle && atRest(s)) {
        clear(e, layer);
        continue;
      }
      set(e.el, "transform", isIdentity(s.transform) ? null : matrixAttr(s.transform));
      set(e.el, "opacity", s.alpha >= 1 ? null : formatSignificant(Math.max(0, s.alpha)));
      set(e.el, "display", s.visible ? null : "none");
      if (!e.path) continue;
      if (s.strokeClip || s.subpathTransforms.length > 0) {
        const p = layer.path;
        e.path.setAttribute(
          "d",
          clipOutline(p.ops, p.argCounts, p.args, [0, p.ops.length], layer.strokeKeyframes, s.strokeStart, s.strokeEnd, s.subpathTransforms),
        );
        e.clipped = true;
      } else restoreD(e, layer);
    }
  }
}

/** Returns every layer of `target` to its static markup. */
export function reset(target: Target): void {
  for (const e of elementsOf(target)) {
    const layer = target.drawing.layers[e.index];
    if (layer) clear(e, layer);
  }
}

// ---- one frame on demand ----

/** The target `renderFrame` keeps per `<svg>`, so a later frame undoes an earlier frame's clip. */
const frames = new WeakMap<SVGSVGElement, Target>();

/**
 * Writes one frame, `states` = `sample(drawing, spec, t)`, to an icon rendered with the per-layer
 * structure, through the same write path as the loop (a timeline scrubber; nothing is scheduled).
 * A layer at rest gets its static markup back. Pause the icon's own effect first (unmount it or
 * leave it idle): a running effect writes over this frame on its next tick.
 *
 * @internal For the demo's timeline; not part of the public API (that is the registration and `Replace`).
 */
export function renderFrame(svg: SVGSVGElement, drawing: AnimDrawing, states: LayerState[]): void {
  let target = frames.get(svg);
  if (!target) {
    target = { svg, drawing };
    frames.set(svg, target);
  } else if (target.drawing !== drawing) {
    // A new geometry (weight, variant): a clipped path is restored to the new static outline.
    target.drawing = drawing;
    for (const e of target.elements ?? []) delete e.whole;
  }
  invalidate(target);
  write([target], [states], true);
}
