import type { AnimDrawing } from "../drawing.js";
import type { Track } from "../keyframes.js";
import { BUDGET_015, CEILING_005, groupCount, groupIndex, range, staggerOffsets } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §7.7 and §4.2: the total, budget and ceiling of each. */
const APPEAR = { total: 0.25, budget: BUDGET_015, ceiling: CEILING_005 };
const DISAPPEAR = { total: f(0.1666666716337204), budget: f(0.10000000149011612), ceiling: f(0.03333333507180214) };
/** 07 §7.7: the scale factor `f`, up (bit 30, the default) and down (bit 31). */
const F_UP = 0.75;
const F_DOWN = 1.25;

/**
 * Appear and Disappear (07 §7.7). Each group gets two tracks from `start_i`:
 * - a `clip-alpha` on curve 14: Appear `0 → 1`, Disappear `1 → 0`;
 * - a `scale`: Appear `f →(c15)→ 1`, Disappear `1 →(c16)→ f`.
 *
 * Both last `T − start_i`, so every group ends at `T` (07 §4.3). `f` is 0.75 up or 1.25 down. Up is
 * the default because bit 30 is on in the default word (07 §7.7). The fade-only form is unreachable
 * and not offered. Order (07 §4.4): Appear Up and Disappear Down run ascending, the other two
 * descending.
 */
function appearDisappear(appear: boolean, d: AnimDrawing, spec: Spec): Plan {
  const c = appear ? APPEAR : DISAPPEAR;
  const down = spec.direction === "down";
  const factor = down ? F_DOWN : F_UP;
  const n = groupCount(d, spec);
  // 07 §4.4 (0x1A78A0C9C–0x1A78A0CC0): ascending when `appear XOR down`.
  const order = appear !== down ? "up" : "down";
  const tracks: Track[] = [];
  staggerOffsets(range(n), c.budget, c.ceiling, order).forEach((start, i) => {
    const g = groupIndex(n, i);
    const duration = c.total - start;
    tracks.push({ property: "clipAlpha", ...g, start, from: appear ? 0 : 1, segments: [{ duration, curve: 14, to: appear ? 1 : 0 }] });
    tracks.push({
      property: "scale",
      ...g,
      start,
      from: appear ? factor : 1,
      segments: [{ duration, curve: appear ? 15 : 16, to: appear ? 1 : factor }],
    });
  });
  return { tracks };
}

export const appearPlan = (d: AnimDrawing, spec: Spec): Plan => appearDisappear(true, d, spec);
export const disappearPlan = (d: AnimDrawing, spec: Spec): Plan => appearDisappear(false, d, spec);
