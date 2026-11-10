import type { AnimDrawing } from "../drawing.js";
import { FILTER, type Track } from "../keyframes.js";
import { groupCount, groupIndex, range, staggerOffsets, staggerStep } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §7.5: π as stored, `3.1415927410125732`. */
const PI = f(3.1415927410125732);
/** 07 §5: the once duration; 07 §7.5: the loop period. */
const TOTAL = 2;
/** 07 §4.2 / §7.5 once: the 2-group fixed step (also the > 2 ceiling), the > 2 budget, and the durations. */
const STEP_2 = f(0.13333334028720856);
const BUDGET_N = f(0.2666666805744171);
const DUR_2 = f(1.8666666746139526);
const DUR_N = f(1.7333333492279053);
/** 07 §7.5 continuous intro: 2.5 s for one group; else staggered (07 §4.2 Rotate continuous row). */
const INTRO_1 = 2.5;
const INTRO_BUDGET = 0.25;
const INTRO_CEILING = f(0.0833333358168602);
const INTRO_RISE = f(0.6666666865348816);
const INTRO_REST = f(1.8333332538604736);
const INTRO_MID = f(0.5297074317932129);

/**
 * Rotate (07 §7.5).
 *
 * Who turns: by layer with some `alwaysRotates` layer, `layer-rotation` with filter
 * `alwaysRotates`, about the rotation anchor, over the motion groups. Otherwise `symbol-rotation`
 * about the metric centre, as one group, by layer or not.
 *
 * Sign: +2π, which is clockwise in y-down space, unless the document's `rotatesClockwise` is
 * `false` (bit 31, −2π) [INF]; a non-default `spec.rotateDirection` overrides it [INF].
 *
 * Once: one group goes `0 →(2, c10)→ ±2π`. Two groups start at `i · 0.1333` and last 1.8667.
 * More start at `i · min(0.2667/(n−1), 0.1333)` and last 1.7333. All end by 2.0.
 *
 * Continuous: a staggered intro that ends at 2.5, then `0 →(2, c12)→ ±2π` in unison.
 */
export function rotatePlan(d: AnimDrawing, spec: Spec): Plan {
  const byLayer = spec.byLayer && d.layers.some((l) => l.alwaysRotates);
  const n = byLayer ? groupCount(d, spec) : 1;
  const base: Pick<Track, "property" | "filter"> = byLayer
    ? { property: "layerRotation", filter: FILTER.alwaysRotates }
    : { property: "symbolRotation" };
  // [INF] an explicit rotateDirection overrides the document's sign (07 §7.5); Apple's mapping not read.
  // Anything but the two explicit values (an untyped caller's absent field too) is the default.
  const clockwise =
    spec.rotateDirection === "clockwise" ? true : spec.rotateDirection === "counterClockwise" ? false : d.rotatesClockwise !== false;
  const turn = (clockwise ? 2 : -2) * PI;

  if (spec.repeat === "continuous") {
    let intro: Track[];
    if (n === 1) intro = [{ ...base, start: 0, from: 0, segments: [{ duration: INTRO_1, curve: 11, to: turn }] }];
    else {
      const mid = Math.sign(turn) * 2 * INTRO_MID;
      intro = staggerOffsets(range(n), INTRO_BUDGET, INTRO_CEILING, "up").map((start, i) => ({
        ...base,
        ...groupIndex(n, i),
        start,
        from: 0,
        segments: [
          { duration: INTRO_RISE, curve: 11, to: mid },
          { duration: INTRO_REST - start, curve: 12, to: turn },
        ],
      }));
    }
    // One header, all groups in unison; curve 12 is linear (07 §3.3), so the loop joins itself.
    const loop: Track = { ...base, start: 0, from: 0, segments: [{ duration: TOTAL, curve: 12, to: turn }] };
    return { tracks: intro, loop: { tracks: [loop], period: TOTAL } };
  }

  const step = n === 2 ? STEP_2 : staggerStep(n, BUDGET_N, STEP_2);
  const dur = n === 1 ? TOTAL : n === 2 ? DUR_2 : DUR_N;
  const tracks: Track[] = range(n).map((i) => ({
    ...base,
    ...groupIndex(n, i),
    start: i * step,
    from: 0,
    segments: [{ duration: dur, curve: 10, to: turn }],
  }));
  return { tracks };
}
