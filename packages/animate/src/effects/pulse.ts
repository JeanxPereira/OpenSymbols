import type { AnimDrawing } from "../drawing.js";
import { FILTER, type Track } from "../keyframes.js";
import { pulseHooks } from "../pulse.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

/** 07 §7.2: each half lasts 1.0 s (bit 31's 0.5 s is unreachable from the public API; not offered). */
const HALF = 1;

/**
 * Who pulses (07 §7.2): by layer with some `alwaysPulses` layer, filter `alwaysPulses` (only those
 * that are not erasers); otherwise every layer. Shared with Breathe (07 §7.3).
 */
export function pulseFilter(d: AnimDrawing, spec: Spec): Pick<Track, "filter"> {
  return spec.byLayer && d.layers.some((l) => l.alwaysPulses) ? { filter: FILTER.alwaysPulses } : {};
}

/**
 * Pulse (07 §7.2): one `pulse-alpha` header, no stagger, `1 →(1, c1)→ 0 →(1, c1)→ 1`, the floor of
 * 07 §7.2 through `pulseHooks`. Once is one 2.0 s cycle (07 §6.5 [INF]); continuous repeats it
 * with no intro (07 §6.3).
 */
export function pulsePlan(d: AnimDrawing, spec: Spec): Plan {
  const track: Track = {
    property: "pulseAlpha",
    ...pulseFilter(d, spec),
    start: 0,
    from: 1,
    segments: [
      { duration: HALF, curve: 1, to: 0 },
      { duration: HALF, curve: 1, to: 1 },
    ],
  };
  const hooks = pulseHooks(d, spec);
  return spec.repeat === "continuous" ? { tracks: [], loop: { tracks: [track], period: 2 * HALF }, ...hooks } : { tracks: [track], ...hooks };
}
