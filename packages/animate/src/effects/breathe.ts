import type { AnimDrawing } from "../drawing.js";
import type { Track } from "../keyframes.js";
import { groupCount, groupIndex, range, staggerOffsets, staggerStep } from "../groups.js";
import { pulseHooks } from "../pulse.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";
import { pulseFilter } from "./pulse.js";

const f = Math.fround;

/** 07 §5: Breathe lasts 3.0 s. */
const TOTAL = 3;
/** 07 §4.2 Breathe row: budget 0.25, ceiling `0.1666666716337204`. */
const BUDGET = 0.25;
const CEILING = f(0.1666666716337204);
/** 07 §7.3: the scale peak, `1.2000000476837158`. */
const PEAK = f(1.2000000476837158);

/**
 * Breathe (07 §7.3): per group `i` from `i · step` (ascending), `half = (3 − step·(n − 1)) / 2`;
 * `pulse-alpha 1 →(half, c1)→ 0 →(half, c1)→ 1` with Pulse's filter and floor (absent with
 * `breathePlain`, bit 31) and `scale 1 →(half, c2)→ 1.2 →(half, c2)→ 1` on every layer. Group `i`
 * ends at `3 − step·(n − 1 − i)` (07 §4.3). Continuous repeats with period 3.0 (07 §7.3 [INF]).
 */
export function breathePlan(d: AnimDrawing, spec: Spec): Plan {
  const n = groupCount(d, spec);
  const step = staggerStep(n, BUDGET, CEILING);
  const half = (TOTAL - step * (n - 1)) * 0.5;
  const pulse = spec.breathePlain ? undefined : pulseFilter(d, spec);
  const tracks: Track[] = [];
  staggerOffsets(range(n), BUDGET, CEILING, "up").forEach((start, i) => {
    const g = groupIndex(n, i);
    if (pulse) {
      tracks.push({
        property: "pulseAlpha",
        ...g,
        ...pulse,
        start,
        from: 1,
        segments: [
          { duration: half, curve: 1, to: 0 },
          { duration: half, curve: 1, to: 1 },
        ],
      });
    }
    tracks.push({
      property: "scale",
      ...g,
      start,
      from: 1,
      segments: [
        { duration: half, curve: 2, to: PEAK },
        { duration: half, curve: 2, to: 1 },
      ],
    });
  });
  const hooks = pulse ? pulseHooks(d, spec) : {};
  return spec.repeat === "continuous" ? { tracks: [], loop: { tracks, period: TOTAL }, ...hooks } : { tracks, ...hooks };
}
