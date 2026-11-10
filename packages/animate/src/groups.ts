import type { AnimDrawing } from "./drawing.js";
import type { Track } from "./keyframes.js";
import type { Spec } from "./spec.js";

const f = Math.fround;

/** 07 §4.2 / §4.6: the 0.15 s budget and 0.05 s ceiling, float32 (07 §2.8). */
export const BUDGET_015 = f(0.15000000596046448);
export const CEILING_005 = f(0.05000000074505806);

/**
 * 07 §4.2: `step = min(B / (n − 1), C)`, 0 for `n < 2`. A budget or ceiling that is not finite and
 * non-negative gives no stagger rather than a NaN (Review Focus 1).
 */
export function staggerStep(n: number, budget: number, ceiling: number): number {
  if (!(n >= 2) || !(budget >= 0) || !(ceiling >= 0)) return 0;
  const step = Math.min(budget / (n - 1), ceiling);
  return Number.isFinite(step) && step >= 0 ? step : 0;
}

/**
 * The start offset of each group in `groups` (compacted indices 0 … n − 1, 07 §4.1, `n =
 * groups.length`): `i · step` ascending ("up") or `(n − 1 − i) · step` descending ("down", the last
 * group leads), 07 §4.4, with the step of 07 §4.2. Every offset is in `[0, budget]` (07 §4.7).
 */
export function staggerOffsets(groups: number[], budget: number, ceiling: number, order: "up" | "down"): number[] {
  const n = groups.length;
  const step = staggerStep(n, budget, ceiling);
  return groups.map((g) => {
    const i = Number.isInteger(g) ? Math.min(Math.max(g, 0), n - 1) : 0;
    return (order === "up" ? i : n - 1 - i) * step;
  });
}

/**
 * 07 §4.6 `layer_delay`: the clock delay of each group of a continuous Bounce or Wiggle, `g' · step`
 * with `step = 0.05` when `n < 5`, else `0.15 / (n − 1)`; `g' = n − 1 − g` for "down" (Bounce Down).
 */
export function clockDelays(n: number, order: "up" | "down"): number[] {
  const step = n < 5 ? CEILING_005 : BUDGET_015 / (n - 1);
  return range(Math.max(n, 1)).map((g) => (n < 2 ? 0 : (order === "up" ? g : n - 1 - g) * step));
}

export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** 07 §4.1: by layer, the compacted motion groups (at least 1); otherwise one group. */
export const groupCount = (d: AnimDrawing, spec: Spec): number => (spec.byLayer ? Math.max(d.groupCount, 1) : 1);

/**
 * The header index of group `i` of `n` (07 §2.2 mode 1). With one group the track reaches every
 * layer (mode 0): `sample` keys by-layer tracks on the layer's own compacted group, so a single
 * group must not carry an index.
 */
export const groupIndex = (n: number, i: number): Pick<Track, "group"> => (n > 1 ? { group: i } : {});
