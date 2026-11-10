import type { AnimLayer } from "../drawing.js";

const f = Math.fround;

/** 07 §7.8: `x = clamp(strokeLength · 0.17182131111621857, 0, 1)`. */
const LENGTH_K = f(0.17182131111621857);
/** 07 §7.8: `dur = x · (2 − x) · 0.8666666746139526 + 0.13333334028720856`. */
const SPAN = f(0.8666666746139526);
const FLOOR = f(0.13333334028720856);
/** 07 §7.8 Total: the tail added to a Draw Off group with a layer clipping its stroke. */
export const CLIP_TAIL = f(0.03333333507180214);

/**
 * 07 §7.8 per-layer duration of a layer that animates its stroke, from its stroke length in point
 * sizes (08 §3; absent or not finite counts as 0): 0.1333 s with no length, up to 1.0 s.
 */
export function layerDrawDuration(layer: AnimLayer): number {
  const len = layer.strokeLength;
  const x = Math.min(Math.max(len !== undefined && Number.isFinite(len) ? len * LENGTH_K : 0, 0), 1);
  return x * (2 - x) * SPAN + FLOOR;
}

/**
 * 07 §7.8 `draw_duration` without the chain (option bit 3 clear: every group starts at 0), over
 * the `layers` given. Per motion group: the maximum of its layers' own durations (a strokable layer)
 * or `base` (any other); on Draw Off plus `CLIP_TAIL` when the group has a layer clipping its
 * stroke (the model: a strokable layer, 08 §2). The total is the latest group end; 0 for no layers.
 */
export function drawDurationUnchained(layers: AnimLayer[], base: number, off: boolean): number {
  const groups = new Map<number, { dur: number; clips: boolean }>();
  for (const l of layers) {
    const g = groups.get(l.group) ?? { dur: 0, clips: false };
    g.dur = Math.max(g.dur, l.strokable ? layerDrawDuration(l) : base);
    if (l.strokable) g.clips = true;
    groups.set(l.group, g);
  }
  let total = 0;
  for (const g of groups.values()) total = Math.max(total, g.dur + (off && g.clips ? CLIP_TAIL : 0));
  return total;
}
