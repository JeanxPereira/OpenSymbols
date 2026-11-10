import type { AnimDrawing } from "../drawing.js";
import type { Track } from "../keyframes.js";
import { BUDGET_015, CEILING_005, groupCount, groupIndex, range, staggerOffsets, staggerStep } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

/** 07 §5: Scale lasts 0.25 s. */
const TOTAL = 0.25;
/** 07 §2.4: the factor `k` at scale level +1 and −1. */
const K_UP = 1.25;
const K_DOWN = 0.5;

/**
 * Scale (07 §7.6). [INF]: the direction arrives as the scale level.
 *
 * Up (`direction` up, or default and not `reversed`) is level 0 → +1, mode 1: a
 * `scale-interpolant 0 →(dur_i, c1)→ 1` from 1 to 1.25. Every group starts at 0 and lasts
 * `0.25 − step·(n − 1 − i)`.
 *
 * Down (`direction` down, or default and `reversed`, 07 §8.3) is 0 → −1, mode 3: curve 41, to 0.5.
 * Group `i` starts at `(n − 1 − i)·step` and all end at 0.25.
 *
 * The factor is held afterwards (07 §7.6). The step is 07 §4.2's 0.15/0.05 row. Returning to level 0
 * (modes 0 and 2) has no `Spec` field and is not offered.
 */
export function scalePlan(d: AnimDrawing, spec: Spec): Plan {
  const down = spec.direction === "down" || (spec.direction === "default" && spec.reversed);
  const n = groupCount(d, spec);
  const tracks: Track[] = [];
  if (down) {
    staggerOffsets(range(n), BUDGET_015, CEILING_005, "down").forEach((start, i) => {
      tracks.push({
        property: "scaleInterpolant",
        interp: [1, K_DOWN],
        ...groupIndex(n, i),
        start,
        from: 0,
        segments: [{ duration: TOTAL - start, curve: 41, to: 1 }],
      });
    });
  } else {
    const step = staggerStep(n, BUDGET_015, CEILING_005);
    for (const i of range(n)) {
      tracks.push({
        property: "scaleInterpolant",
        interp: [1, K_UP],
        ...groupIndex(n, i),
        start: 0,
        from: 0,
        segments: [{ duration: TOTAL - step * (n - 1 - i), curve: 1, to: 1 }],
      });
    }
  }
  return { tracks };
}
