import type { Role } from "@opensymbols/core";
import type { AnimDrawing, AnimLayer } from "./drawing.js";
import type { Plan } from "./sample.js";
import type { Spec } from "./spec.js";

/** 07 §2.7 [INF]: the hierarchy levels, primary 1, secondary 2, tertiary 3. */
const LEVEL: Record<Role, 1 | 2 | 3> = { primary: 1, secondary: 2, tertiary: 3 };

/** 07 §2.7 [INF]: `Model::alpha(n)` taken as the hierarchical paint opacities of level `n`. */
const LEVEL_OPACITY: Record<Spec["appearance"], Record<1 | 2 | 3, number>> = {
  light: { 1: 1, 2: 0.5, 3: 0.18 },
  dark: { 1: 1, 2: 0.5, 3: 0.25 },
};

/** 07 §2.7 [INF]: `Model::alpha(level)`, the hierarchical paint opacity of `level` in `appearance`. */
export function levelAlpha(appearance: Spec["appearance"], level: 1 | 2 | 3): number {
  return LEVEL_OPACITY[appearance][level];
}

/**
 * The pulse-alpha floor and alpha cap for Pulse and Breathe (07 §7.2). With some layer
 * `alwaysPulses`, by layer, in hierarchical mode, a layer's floor is `alpha(m) / alpha(level)`,
 * `m = level − 1` if `level > 1` else `level + 1`, and an always-pulses layer's alpha is capped at
 * `1 / levelOpacity` so the painted alpha stays ≤ 1 (07 §2.7). Otherwise no hooks: the default
 * floor `0.30000001192092896` and cap 1.
 */
export function pulseHooks(d: AnimDrawing, spec: Spec): Pick<Plan, "pulseFloor" | "alphaCap"> {
  if (!(spec.byLayer && spec.renderingMode === "hierarchical" && d.layers.some((l) => l.alwaysPulses))) return {};
  const op = LEVEL_OPACITY[spec.appearance];
  return {
    pulseFloor: (l: AnimLayer) => {
      const level = LEVEL[l.role];
      const m = level > 1 ? level - 1 : level + 1;
      return op[m as 1 | 2 | 3] / op[level];
    },
    alphaCap: (l: AnimLayer) => (l.alwaysPulses ? 1 / op[LEVEL[l.role]] : 1),
  };
}
