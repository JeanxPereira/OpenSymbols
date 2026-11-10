import type { AnimDrawing } from "../drawing.js";
import type { Property, Track } from "../keyframes.js";
import { clockDelays, groupCount, groupIndex, range, staggerOffsets } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §7.4: the four beats and the shrunk settle (`0.267 − start_i`, 07 §4.3). */
const BEAT = f(0.16699999570846558);
const SETTLE = f(0.2670000195503235);
/** 07 §4.2 Wiggle (once) row: budget `0.1499999761581421`, ceiling `0.05000000074505806`. */
const BUDGET = f(0.1499999761581421);
const CEILING = f(0.05000000074505806);
/** 07 §7.4: once values `a3, a2, a1, a0` in play order (10°, −8°, 6°, −5°), radians; table 0x1A7960D20. */
const ROTATION = [f(0.1745329201221466), f(-0.13962633907794952), f(0.10471975803375244), f(-0.0872664600610733)];
/** 07 §7.4: the same in point sizes (0.06, −0.04, 0.03, −0.025); table 0x1A7960D30. */
const TRANSLATION = [f(0.05999999865889549), f(-0.03999999910593033), f(0.029999999329447746), f(-0.02500000037252903)];
/** 07 §7.4: the continuous amplitude, radians or point sizes. */
const AMP_ROTATION = f(0.0872664600610733);
const AMP_TRANSLATION = f(0.02500000037252903);
/** 07 §7.4: 1/12 and 1/6; the loop period 1/3 (07 §5). */
const TWELFTH = f(0.0833333358168602);
const SIXTH = f(0.1666666716337204);
const PERIOD = f(0.3333333432674408);

/**
 * The property, sign and direction from the document's `wiggleStyle` (07 §7.4 [INF]):
 * - `linear` or absent: a `translation` along `dir = (cos θ, sin θ)`, `θ = wiggleAngle` degrees (0
 *   when absent), in output space with y down, so 0° is +x and a positive angle turns clockwise on
 *   screen. [INF]; Apple's vector for an angle is not read (07 §7.4 [OBS], §11).
 * - `clockwise`: bit 31, a rotation (layer rotation by layer, else symbol rotation).
 * - `counterClockwise`: bits 31 and 30, the rotation with every value negated.
 */
function style(d: AnimDrawing, spec: Spec): { property: Property; sign: number; dir?: [number, number] } {
  const s = d.wiggleStyle ?? "linear";
  if (s === "linear") {
    const theta = ((d.wiggleAngle ?? 0) * Math.PI) / 180;
    return { property: "translation", sign: 1, dir: [Math.cos(theta), Math.sin(theta)] };
  }
  return { property: spec.byLayer ? "layerRotation" : "symbolRotation", sign: s === "counterClockwise" ? -1 : 1 };
}

/**
 * Wiggle (07 §7.4): no layer filter.
 * - Once: per group from `i · step` (ascending, 07 §4.4),
 *   `0 →(0.167, c6)→ a3 →(0.167, c7)→ a2 →(0.167, c7)→ a1 →(0.167, c7)→ a0 →(0.267 − start_i, c7)→ 0`;
 *   every group ends at 0.935 (07 §4.3).
 * - Continuous (bit 4): one header. Intro `0 →(1/12, c7)→ +A →(1/6, c7)→ −A →(1/12, c9)→ 0`; the
 *   loop is the same with c8 first, period 1/3. The by-layer stagger is a clock delay, never
 *   reversed (07 §4.6).
 */
export function wigglePlan(d: AnimDrawing, spec: Spec): Plan {
  const { property, sign, dir } = style(d, spec);
  const rotation = property !== "translation";
  const base: Pick<Track, "property" | "dir"> = dir ? { property, dir } : { property };
  const n = groupCount(d, spec);
  if (spec.repeat === "continuous") {
    const a = sign * (rotation ? AMP_ROTATION : AMP_TRANSLATION);
    const cycle = (first: number): Track => ({
      ...base,
      start: 0,
      from: 0,
      segments: [
        { duration: TWELFTH, curve: first, to: a },
        { duration: SIXTH, curve: 7, to: -a },
        { duration: TWELFTH, curve: 9, to: 0 },
      ],
    });
    return { tracks: [cycle(7)], loop: { tracks: [cycle(8)], period: PERIOD }, groupDelay: clockDelays(n, "up") };
  }
  const values = (rotation ? ROTATION : TRANSLATION).map((v) => sign * v);
  const tracks: Track[] = staggerOffsets(range(n), BUDGET, CEILING, "up").map((start, i) => ({
    ...base,
    ...groupIndex(n, i),
    start,
    from: 0,
    segments: [
      { duration: BEAT, curve: 6, to: values[0]! },
      { duration: BEAT, curve: 7, to: values[1]! },
      { duration: BEAT, curve: 7, to: values[2]! },
      { duration: BEAT, curve: 7, to: values[3]! },
      { duration: SETTLE - start, curve: 7, to: 0 },
    ],
  }));
  return { tracks };
}
