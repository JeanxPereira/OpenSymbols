import type { AnimDrawing } from "../drawing.js";
import type { Track } from "../keyframes.js";
import { clockDelays, groupCount, groupIndex, range, staggerOffsets } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §7.1: 13/60, the rise and the rebound. */
const D13 = f(0.21666666865348816);
/** 07 §7.1: the settle, `0.2666666507720947 − start_i` (07 §4.3). */
const SETTLE = f(0.2666666507720947);
/** 07 §4.2 Bounce (once) row: budget `0.1499999761581421`, ceiling `0.05000000074505806`. */
const BUDGET = f(0.1499999761581421);
const CEILING = f(0.05000000074505806);
/** 07 §7.1 continuous outro: `B →(0.2666666805744171, c5)→ 1.0`. */
const OUTRO = f(0.2666666805744171);
/** 07 §5: the continuous period. */
const PERIOD = f(0.4333333373069763);

/** 07 §7.1: peak `P` and rebound `R` (once), `A` and `B` (continuous), Up and Down. */
const VALUES = {
  up: { P: 1.25, R: f(0.9089999794960022), A: f(1.0499999523162842), B: f(0.949999988079071) },
  down: { P: 0.75, R: f(1.1089999675750732), A: f(0.949999988079071), B: f(1.059000015258789) },
} as const;

/**
 * Bounce (07 §7.1): property `scale` about the metric centre. `direction: "down"` is bit 31 (07
 * §8.3): Down values and the descending order. Once: per group `1 → P → R → 1`, staggered (07 §4.2,
 * §4.4), the settle shrunk so every group ends at 0.7 (07 §4.3). Continuous (bit 4): one header,
 * intro `1 → A → B`, loop `B → A → B` every 0.4333 s, the by-layer stagger a clock delay (07 §4.6);
 * stopped, the outro `B → 1` from each group's cycle end (07 §6.3 [INF]).
 */
export function bouncePlan(d: AnimDrawing, spec: Spec): Plan {
  const order = spec.direction === "down" ? "down" : "up";
  const v = VALUES[order];
  const n = groupCount(d, spec);
  if (spec.repeat === "continuous") {
    const intro: Track = { property: "scale", start: 0, from: 1, segments: [{ duration: D13, curve: 3, to: v.A }, { duration: D13, curve: 4, to: v.B }] };
    const loop: Track = { property: "scale", start: 0, from: v.B, segments: [{ duration: D13, curve: 3, to: v.A }, { duration: D13, curve: 4, to: v.B }] };
    // 07 §7.1 outro. [INF] When Apple starts it is not read (07 §6.2); the model starts it at each
    // group's cycle end, where the loop is at `B`, so stopping never jumps (07 §6.3).
    const outro: Track = { property: "scale", start: 0, from: v.B, segments: [{ duration: OUTRO, curve: 5, to: 1 }] };
    return { tracks: [intro], loop: { tracks: [loop], period: PERIOD }, outro: { tracks: [outro] }, groupDelay: clockDelays(n, order) };
  }
  const starts = staggerOffsets(range(n), BUDGET, CEILING, order);
  const tracks: Track[] = starts.map((start, i) => ({
    property: "scale",
    ...groupIndex(n, i),
    start,
    from: 1,
    segments: [
      { duration: D13, curve: 3, to: v.P },
      { duration: D13, curve: 4, to: v.R },
      { duration: SETTLE - start, curve: 5, to: 1 },
    ],
  }));
  return { tracks };
}
