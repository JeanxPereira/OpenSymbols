import type { AnimDrawing } from "../drawing.js";
import { BUDGET_015, CEILING_005, groupIndex, range, staggerOffsets } from "../groups.js";
import type { Filter, Track } from "../keyframes.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";
import { CLIP_TAIL, layerDrawDuration } from "./draw-timing.js";

const f = Math.fround;

/** 07 §7.8 the base duration of a group's non-strokable layer: On 0.25, Off 0.1666666716337204. */
const BASE_ON = 0.25;
const BASE_OFF = f(0.1666666716337204);
/** 07 §7.8 the chain: a fraction of the previous group's duration (On, Off; 1.0 individually). */
const CHAIN_ON = f(0.18000000715255737);
const CHAIN_OFF = f(0.3799999952316284);
/** 07 §7.8 Draw Off's plateau `1 − 1e-4` (float32 `0.99989998`, 07 §2.8) and `+1e-4`. */
const PLATEAU = f(1 - 1e-4);
const PLATEAU_LOW = f(1e-4);
/** 07 §7.8 the stroke curves: 17 On, 18 Off; 0 (linear) individually. */
const CURVE_ON = 17;
const CURVE_OFF = 18;
/** 07 §7.7 via §7.8: the fallback is the "up" Appear / Disappear (scale 0.75). */
const UP = 0.75;
const DISAPPEAR_BUDGET = f(0.10000000149011612);
const DISAPPEAR_CEILING = f(0.03333333507180214);
/** 07 §7.8: the fallback reaches layers that do not animate their stroke (filter mask 0x10, value 0). */
const NOT_STROKE: Filter = { mask: 0x10, value: 0 };

/** 07 §7.8 `draw_timing_groups` and `draw_duration`: each real group's start and duration, and the total. */
export function drawTiming(d: AnimDrawing, spec: Spec): { starts: number[]; durations: number[]; total: number; individually: boolean } {
  const on = !spec.reversed;
  const n = Math.max(d.groupCount, 1);
  const base = on ? BASE_ON : BASE_OFF;
  // One TimingGroup per real group, whatever bit 3 says: the maximum over its layers.
  const durations = range(n).map(() => 0);
  const clips = range(n).map(() => false);
  for (const l of d.layers) {
    const g = Math.min(Math.max(l.group, 0), n - 1);
    durations[g] = Math.max(durations[g]!, l.strokable ? layerDrawDuration(l) : base);
    if (l.strokable) clips[g] = true;
  }
  // `.individually` is bits 3 and 31; with one group bit 31 is cleared.
  const individually = spec.byLayer && spec.drawIndividually && n > 1;
  const starts = range(n).map(() => 0);
  if (spec.byLayer) {
    // Order: (Off AND bit 30) vs drawReversesMotionGroups; equal → from group 0 up, else from the last down.
    const ascending = (!on && spec.drawReversedOrder) === d.drawReversesMotionGroups;
    const frac = individually ? 1 : on ? CHAIN_ON : CHAIN_OFF;
    let t = 0;
    for (let k = 0; k < n; k++) {
      const g = ascending ? k : n - 1 - k;
      starts[g] = t;
      t += frac * durations[g]!;
    }
  }
  let total = 0;
  for (let g = 0; g < n; g++) total = Math.max(total, starts[g]! + durations[g]! + (!on && clips[g] ? CLIP_TAIL : 0));
  return { starts, durations, total, individually };
}

/**
 * Draw On and Draw Off (07 §7.8). `spec.reversed` is Off; `drawReversedOrder` is Off's bit 30
 * (retract to the start, and flip the group order); `drawIndividually` is bit 31 with bit 3.
 *
 * Every strokable layer (08 §2) gets its own stroke list from its group's start, lasting its own
 * duration: On `stroke-end 0 → 1` (curve 17), Off `stroke-start 0 → 1` or, reversed, `stroke-end
 * 1 → 0` (curve 18), with Off's 1/30 s plateau and the rider scale ramp. The stroke range lands in
 * `LayerState` for the clip (08); riders are resolved after sampling. Layers that cannot animate
 * their stroke take the "up" Appear (On) or Disappear (Off) on Draw's group clock.
 */
export function drawPlan(d: AnimDrawing, spec: Spec): Plan {
  const on = !spec.reversed;
  const retract = !on && spec.drawReversedOrder;
  const { starts, total, individually } = drawTiming(d, spec);
  const n = starts.length;
  const curve = individually ? 0 : on ? CURVE_ON : CURVE_OFF;
  const tracks: Track[] = [];

  d.layers.forEach((l, layer) => {
    if (!l.strokable) return;
    const start = spec.byLayer ? starts[Math.min(Math.max(l.group, 0), n - 1)]! : 0;
    const dur = layerDrawDuration(l);
    if (on) {
      tracks.push({ property: "strokeEnd", layer, start, from: 0, segments: [{ duration: dur, curve, to: 1 }] });
      return;
    }
    // Draw Off on a layer that clips its stroke: the plateau, then the rider scale from start + dur.
    tracks.push(
      retract
        ? {
            property: "strokeEnd",
            layer,
            start,
            from: 1,
            segments: [
              { duration: dur, curve, to: PLATEAU_LOW },
              { duration: CLIP_TAIL, curve: 0, to: PLATEAU_LOW },
              { duration: 0, curve: 0, to: 0 },
            ],
          }
        : {
            property: "strokeStart",
            layer,
            start,
            from: 0,
            segments: [
              { duration: dur, curve, to: PLATEAU },
              { duration: CLIP_TAIL, curve: 0, to: PLATEAU },
              { duration: 0, curve: 0, to: 1 },
            ],
          },
      {
        property: "attachmentScale",
        layer,
        start: start + dur,
        from: 1,
        segments: [
          { duration: CLIP_TAIL, curve: 0, to: 0.5 },
          { duration: 0, curve: 0, to: 0 },
        ],
      },
    );
  });

  if (d.layers.some((l) => !l.strokable)) {
    // `make_appear_disappear_keyframes(on, bit 30, the timing groups, mask 0x10)`: group i from its
    // timing start (with bit 3), lasting T − offset_i, offset_i the Appear / Disappear stagger.
    const groups = spec.byLayer ? n : 1;
    const T = on ? BASE_ON : BASE_OFF;
    const offsets = on
      ? staggerOffsets(range(groups), BUDGET_015, CEILING_005, "up")
      : staggerOffsets(range(groups), DISAPPEAR_BUDGET, DISAPPEAR_CEILING, "down");
    for (let i = 0; i < groups; i++) {
      const g = groupIndex(groups, i);
      const start = spec.byLayer ? starts[i]! : 0;
      const duration = T - offsets[i]!;
      tracks.push(
        { property: "clipAlpha", ...g, filter: NOT_STROKE, start, from: on ? 0 : 1, segments: [{ duration, curve: 14, to: on ? 1 : 0 }] },
        { property: "scale", ...g, filter: NOT_STROKE, start, from: on ? UP : 1, segments: [{ duration, curve: on ? 15 : 16, to: on ? 1 : UP }] },
      );
    }
  }

  const plan: Plan = { tracks, total };
  // 07 §7.8 `.individually`: the whole clock warped once, t' = total · curve(t / total).
  if (individually) {
    plan.timeSpan = total;
    plan.timeCurve = on ? CURVE_ON : CURVE_OFF;
  }
  return plan;
}
