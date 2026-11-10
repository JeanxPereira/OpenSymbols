import type { AnimDrawing } from "../drawing.js";
import type { Filter, Track } from "../keyframes.js";
import { BUDGET_015, CEILING_005, groupCount, groupIndex, range, staggerStep } from "../groups.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §7.9: the out half's span, and the in half's `s0` in styles 0, 1 (the out half's end). */
const HALF = 0.25;
/** 07 §7.9 style 2: `s0 = 0.1666666567325592`, the in half's `0.3330000042915344`, from 0.4. */
const S0_UPUP = f(0.1666666567325592);
const IN_UPUP = f(0.3330000042915344);
const FROM_UPUP = f(0.4000000059604645);
/** 07 §7.9 style 0: the fade's floor `0.20000000298023224`. */
const PLAIN_FLOOR = f(0.20000000298023224);
/** 07 §7.9 styles 1, 3 (down to 0.5) and 2 (up to 1.25). */
const DOWN = 0.5;
const UP = 1.25;
/** 07 §5 (0x1A789C578): Replace lasts 0.5, 0.25 in style 3. */
const TOTAL = 0.5;
const TOTAL_OFFUP = 0.25;

export type ReplaceStyle = Spec["replaceStyle"];

/** 07 §7.9: the in half's start `s0` by style. */
export function replaceS0(style: ReplaceStyle): number {
  return style === "upUp" ? S0_UPUP : style === "offUp" ? 0 : HALF;
}

/** 07 §5: the plain Replace's total by style. */
export const replaceTotal = (style: ReplaceStyle): number => (style === "offUp" ? TOTAL_OFFUP : TOTAL);

/** Spread `filter` onto a track when there is one. */
const withFilter = (filter: Filter | undefined): Pick<Track, "filter"> => (filter ? { filter } : {});

/**
 * 07 §7.9 the out half (the source glyph, `make_replace_from_keyframes`), from `t = 0`; `filter`
 * narrows the layers reached (Magic Replace, 07 §7.10). Step 07 §4.2's Replace row, order §4.4.
 */
export function replaceOutTracks(d: AnimDrawing, spec: Spec, filter?: Filter): Track[] {
  const n = groupCount(d, spec);
  const step = staggerStep(n, BUDGET_015, CEILING_005);
  const flt = withFilter(filter);
  switch (spec.replaceStyle) {
    case "plain":
      // 1 →(0.25, c1)→ 0.2 →(0, c0)→ 0, every layer; no scale.
      return [{ property: "clipAlpha", ...flt, start: 0, from: 1, segments: [{ duration: HALF, curve: 1, to: PLAIN_FLOOR }, { duration: 0, curve: 0, to: 0 }] }];
    case "upUp":
      // Every group from 0, lasting 0.25 − step·(n−1−i): scale 1 → 1.25 and alpha 1 → 0, curve 21.
      return range(n).flatMap((i): Track[] => {
        const g = groupIndex(n, i);
        const duration = HALF - step * (n - 1 - i);
        return [
          { property: "scale", ...g, ...flt, start: 0, from: 1, segments: [{ duration, curve: 21, to: UP }] },
          { property: "alpha", ...g, ...flt, start: 0, from: 1, segments: [{ duration, curve: 21, to: 0 }] },
        ];
      });
    case "offUp":
      // clip-alpha with only the final value 0: gone at once.
      return [{ property: "clipAlpha", ...flt, start: 0, from: 0, segments: [] }];
    default: {
      // downUp (style 1, the default): group i from (n−1−i)·step, 1 →(0.25 − start, c19)→ 0.5; clip-alpha 1 →(0)→ 0 at 0.25.
      const tracks: Track[] = range(n).map((i) => {
        const start = (n - 1 - i) * step;
        return { property: "scale", ...groupIndex(n, i), ...flt, start, from: 1, segments: [{ duration: HALF - start, curve: 19, to: DOWN }] };
      });
      tracks.push({ property: "clipAlpha", ...flt, start: HALF, from: 1, segments: [{ duration: 0, curve: 0, to: 0 }] });
      return tracks;
    }
  }
}

/**
 * 07 §7.9 the in half (the destination, `make_replace_to_keyframes`), starting at `s0` (the style's
 * own unless Magic Replace moves it, 07 §7.10); `filter` narrows the layers reached.
 */
export function replaceInTracks(d: AnimDrawing, spec: Spec, s0: number = replaceS0(spec.replaceStyle), filter?: Filter): Track[] {
  const n = groupCount(d, spec);
  const step = staggerStep(n, BUDGET_015, CEILING_005);
  const flt = withFilter(filter);
  switch (spec.replaceStyle) {
    case "plain":
      // clip-alpha 0 →(0, c0)→ 0.2 →(0.25, c1)→ 1 from s0.
      return [{ property: "clipAlpha", ...flt, start: s0, from: 0, segments: [{ duration: 0, curve: 0, to: PLAIN_FLOOR }, { duration: HALF, curve: 1, to: 1 }] }];
    case "upUp":
      // Group i from s0 + step·i: scale 0.4 → 1 and clip-alpha 0 → 1 over 0.333 − step·i, curve 22.
      return range(n).flatMap((i): Track[] => {
        const g = groupIndex(n, i);
        const start = s0 + step * i;
        const duration = IN_UPUP - step * i;
        return [
          { property: "scale", ...g, ...flt, start, from: FROM_UPUP, segments: [{ duration, curve: 22, to: 1 }] },
          { property: "clipAlpha", ...g, ...flt, start, from: 0, segments: [{ duration, curve: 22, to: 1 }] },
        ];
      });
    case "offUp":
      // Every group from s0, lasting 0.25 − step·(n−1−i): scale 0.5 → 1 on c23, clip-alpha 0 → 1 on c24.
      return range(n).flatMap((i): Track[] => {
        const g = groupIndex(n, i);
        const duration = HALF - step * (n - 1 - i);
        return [
          { property: "scale", ...g, ...flt, start: s0, from: DOWN, segments: [{ duration, curve: 23, to: 1 }] },
          { property: "clipAlpha", ...g, ...flt, start: s0, from: 0, segments: [{ duration, curve: 24, to: 1 }] },
        ];
      });
    default: {
      // downUp: clip-alpha 0 →(0)→ 1 at s0; every group from s0, 0.5 →(0.25 − step·(n−1−i), c20)→ 1.
      const tracks: Track[] = [{ property: "clipAlpha", ...flt, start: s0, from: 0, segments: [{ duration: 0, curve: 0, to: 1 }] }];
      for (const i of range(n)) {
        tracks.push({ property: "scale", ...groupIndex(n, i), ...flt, start: s0, from: DOWN, segments: [{ duration: HALF - step * (n - 1 - i), curve: 20, to: 1 }] });
      }
      return tracks;
    }
  }
}

/**
 * Replace (07 §7.9), one drawing of the pair: `spec.replaceHalf` "out" plays the source's half,
 * "in" the destination's, both on one clock from `t = 0`. The two drawings' layers never need to
 * correspond. Also serves `magicReplace` sampled one drawing at a time: with no partner there is no
 * subtype to infer, which is the plain Replace (07 §7.10 step 5); `replacePair` infers it.
 */
export function replacePlan(d: AnimDrawing, spec: Spec): Plan {
  const tracks = spec.replaceHalf === "in" ? replaceInTracks(d, spec) : replaceOutTracks(d, spec);
  return { tracks, total: replaceTotal(spec.replaceStyle) };
}
