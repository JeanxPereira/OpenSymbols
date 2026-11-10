import type { AnimDrawing } from "../drawing.js";
import type { Track } from "../keyframes.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

/** 07 §9.2 [INF]: the half-width of the continuous band around a threshold. */
const BAND = 0.06;

/**
 * 07 §9.2: an inactive layer rests at the `variable-alpha-fade` target (07 §2.3 property 10),
 * float32 `0.30000001192092896`; 0 needs option bit 29, which `Spec` does not offer.
 */
const INACTIVE = Math.fround(0.3);

/** 07 §9.2 [INF]: a non-finite value reads 0 (an absent one too); then clamped to [0, 1]. */
const value = (v: number | undefined): number => (v === undefined || !Number.isFinite(v) ? 0 : Math.min(1, Math.max(0, v)));

const clampUnit = (x: number): number => Math.min(1, Math.max(0, x));

/** A constant track on one layer: no segment, so it holds `from` at every t. */
const hold = (property: Track["property"], layer: number, from: number): Track => ({ property, layer, start: 0, from, segments: [] });

/**
 * Static Variable Color (07 §9.2–§9.3): the value is a position, not a time, so every track is a
 * constant. Colour mode: an `alpha` per layer with a threshold, 1 when active and 0.3 when not. Draw mode: a `stroke-end` per
 * layer, which is the Draw range `[0, fraction]` on a strokable layer and `alpha *= fraction` on
 * any other (07 §2.3, §9.3). The animated forms are not specified (07 §9.6).
 */
export function variableColorPlan(d: AnimDrawing, spec: Spec): Plan {
  const v = value(spec.variableValue);
  const tracks: Track[] = [];
  if (d.variableValueMode === "color") {
    d.layers.forEach((l, i) => {
      const theta = l.variableThreshold;
      if (theta === undefined) return; // drawn at full alpha
      const alpha = d.vcContinuous
        ? INACTIVE + (1 - INACTIVE) * clampUnit((v - (theta - BAND)) / (2 * BAND)) // band
        : v >= theta // hard cut, compared directly
          ? 1
          : INACTIVE;
      tracks.push(hold("alpha", i, alpha));
    });
  } else {
    const n = Math.max(d.groupCount, 1);
    d.layers.forEach((l, i) => {
      // A layer without a pair takes its motion group's band (i/n, 1/n), ascending (07 §9.3, §4.1).
      const [offset, length] = l.variableDraw ?? [l.group / n, 1 / n];
      const fraction = length <= 0 ? (v >= offset ? 1 : 0) : clampUnit((v - offset) / length);
      tracks.push(hold("strokeEnd", i, fraction));
    });
  }
  return { tracks };
}
