import type { AnimDrawing } from "../drawing.js";
import { FILTER, type Track } from "../keyframes.js";
import { levelAlpha } from "../pulse.js";
import type { Plan } from "../sample.js";
import type { Spec } from "../spec.js";

const f = Math.fround;

/** 07 §9.2 [INF]: the half-width of the continuous band around a threshold. */
const BAND = 0.06;

/**
 * 07 §9.2: an inactive layer rests at the `variable-alpha-fade` target (07 §2.3 property 10),
 * float32 `0.30000001192092896`.
 */
const INACTIVE = f(0.3);

// 07 §9.5: the float32 constants of the `vc_*` builders.
/** `0.3333333432674408`: intro, outro, rise and fall of the short forms. */
const T3 = f(1 / 3);
/** `0.6666666865348816`: the cumulative n = 2 hold base, and the 2/3 terms. */
const C84 = f(0.6666666865348816);
/** `0.6666666269302368`: the cumulative step budget for n ≥ 4. */
const CC4 = f(0.6666666269302368);
const K60 = f(0.01666666753590107);
const K12 = f(0.0833333358168602);
const K9 = f(0.111111119389534);
const K43 = f(1.3333333730697632);
const K524 = f(0.2083333432674408);
const K512 = f(0.4166666865348816);

/** 07 §9.2 [INF]: a non-finite value reads 0; then clamped to [0, 1]. */
const value = (v: number): number => (!Number.isFinite(v) ? 0 : Math.min(1, Math.max(0, v)));

const clampUnit = (x: number): number => Math.min(1, Math.max(0, x));

/** A constant track on one layer: no segment, so it holds `from` at every t. */
const hold = (property: Track["property"], layer: number, from: number): Track => ({ property, layer, start: 0, from, segments: [] });

/** Which layers a `vc_*` header reaches (07 §9.5). */
type Head = Pick<Track, "property" | "rank" | "filter">;

/** Header word 1 (`alpha`, any layer, index 0): every builder when n = 0 (07 §9.5). */
const ALL: Head = { property: "alpha" };
/** Header 0x06000008: `variable-alpha` on threshold rank `k` (index mode 3). */
const rank = (k: number): Head => ({ property: "variableAlpha", rank: k });
/** Header 0x06000009: `variable-alpha-max` on rank 1, the wrap of the "+1" (07 §9.5). */
const WRAP: Head = { property: "variableAlphaMax", rank: 1 };

/** `from →(d, c)→ to …` as a track. */
function list(head: Head, start: number, from: number, segs: Array<[number, number, number]>): Track {
  return { ...head, start, from, segments: segs.map(([duration, curve, to]) => ({ duration, curve, to })) };
}

/** One cycle of an animated form (07 §9.5), times from the start of the loop phase. */
export interface VcCycle {
  /** The loop phase's tracks, in header order. */
  tracks: Track[];
  /** `local_duration`: the cycle, without the repeat gap (07 §5, §9.5). */
  duration: number;
  /** The repeat gap: the cycle's last values hold this long before the next cycle or the outro. */
  gap: number;
  /** The wave only: per threshold rank (index 0 for layers without one), the clock delay after the intro. */
  delay?: number[];
}

/** 07 §9.5: the iterative wave constants for `N > 3`: decay `t`, the natural cycle `Dn`. */
function waveUnits(N: number): { t: number; Dn: number } {
  const t = T3 + (2 * N - 8) * K60;
  return { t, Dn: t + N * K12 };
}

/**
 * 07 §9.5 `vc_cumulative` (style 0). n ≤ 1: `a →(1/3,c1)→ 1 →(1/3,c0)→ 1 →(1/3,c1)→ a` on rank 1, or
 * as `alpha` on every layer when n = 0. n ≥ 2: rank k = i + 1 starts at `i·s` and runs
 * `a →(1/3,c1)→ 1 →(E − i·s, c0)→ 1 →(1/3,c1)→ a`, `s = 1/3` (n ≤ 3) or `0.6666666269302368/(n−1)`,
 * `E = 0.6666666865348816` (n = 2) or 1. Duration `clamp(n,1,3)·1/3 + 2/3`.
 */
export function vcCumulative(n: number, a: number): Omit<VcCycle, "gap"> {
  const duration = Math.min(Math.max(n, 1), 3) * T3 + C84;
  if (n <= 1) return { tracks: [list(n === 0 ? ALL : rank(1), 0, a, [[T3, 1, 1], [T3, 0, 1], [T3, 1, a]])], duration };
  const s = n <= 3 ? T3 : CC4 / (n - 1);
  const E = n === 2 ? C84 : 1;
  const tracks: Track[] = [];
  for (let i = 0; i < n; i++) tracks.push(list(rank(i + 1), i * s, a, [[T3, 1, 1], [E - i * s, 0, 1], [T3, 1, a]]));
  return { tracks, duration };
}

/**
 * 07 §9.5 `vc_cumulative_bounce` (style 1). n ≤ 1 as `vcCumulative`. n ≥ 2: same `s`; rank
 * k = i + 1 starts at `i·s` and runs `a →(1/3,c1)→ 1 →(2s(n−1−i) + 1/3, c0)→ 1 →(1/3,c1)→ a`: lit
 * ascending, faded descending. Duration `clamp(n,1,3)·2/3 + 1/3`.
 */
export function vcCumulativeReversing(n: number, a: number): Omit<VcCycle, "gap"> {
  const duration = Math.min(Math.max(n, 1), 3) * C84 + T3;
  if (n <= 1) return { tracks: vcCumulative(n, a).tracks, duration };
  const s = n <= 3 ? T3 : CC4 / (n - 1);
  const tracks: Track[] = [];
  for (let i = 0; i < n; i++) tracks.push(list(rank(i + 1), i * s, a, [[T3, 1, 1], [2 * s * (n - 1 - i) + T3, 0, 1], [T3, 1, a]]));
  return { tracks, duration };
}

/**
 * 07 §9.5 `vc_sequential` (style 2) without option bit 6. `N = n + 1` with `plus1` (bit 28, the
 * symbol's `vcContinuous`, with a positive repeat delay, which `Spec` never selects), else `n`. One
 * shared list `a →(r,c1)→ 1 →(f,c1)→ a`, rank k starting at `(k−1)·r`; with `plus1` the last
 * header is `variable-alpha-max` on rank 1 (the wave wraps to its start). N ≤ 3: `r = f = 1/3`,
 * duration `(clamp(N,1,3) + 1)/3`; N = 0: `alpha` on every layer. N > 3: `t = 1/3 + (2N−8)/60`,
 * `Dn = t + N/12`, `r = (1/9)/Dn`, `f = (4/3)·t/Dn`, duration 4/3.
 */
export function vcIterative(n: number, plus1: boolean, a: number): Omit<VcCycle, "gap"> {
  const N = n + (plus1 ? 1 : 0);
  let r = T3;
  let fall = T3;
  let duration = (Math.min(Math.max(N, 1), 3) + 1) * T3;
  if (N > 3) {
    const { t, Dn } = waveUnits(N);
    r = K9 / Dn;
    fall = (K43 * t) / Dn;
    duration = K43;
  }
  const tracks: Track[] = [];
  for (let i = 0; i < Math.max(N, 1); i++) {
    const head = N === 0 ? ALL : plus1 && i === N - 1 ? WRAP : rank(i + 1);
    tracks.push(list(head, i * r, a, [[r, 1, 1], [fall, 1, a]]));
  }
  return { tracks, duration };
}

/**
 * 07 §9.5 `vc_sequential_bounce` (style 3), `N = n + (plus1 ? 1 : 0)` (bit 28); header i is rank
 * i + 1, or `variable-alpha-max` on rank 1 when `plus1` and i = N − 1; N = 0: `alpha` on every layer.
 * N ≤ 2 (one header when N = 0), duration 2/3: i = 0 `1 → a → 1`, i = 1 `a → 1 → a`, each step
 * 1/3 on c1. N = 3, duration 4/3: i = 0 `1 → a ⋯ a → 1` (hold 2/3), i = 1 `a → 1 → a → 1 → a`,
 * i = 2 from 1/3 `a → 1 → a`. N > 3, duration 2.5: `t` as iterative, `Db = 2(t + (N−2)/12)`,
 * `s = (5/24)/Db`, `F = 2.5·t/Db`, `h = (5/12)/Db`, header i from `max(i−1, 0)·s`.
 */
export function vcIterativeReversing(n: number, plus1: boolean, a: number): Omit<VcCycle, "gap"> {
  const N = n + (plus1 ? 1 : 0);
  const head = (i: number): Head => (N === 0 ? ALL : plus1 && N - 1 - i === 0 ? WRAP : rank(i + 1));
  if (N <= 2) {
    const tracks = [list(head(0), 0, 1, [[T3, 1, a], [T3, 1, 1]])];
    if (N > 0) tracks.push(list(head(1), 0, a, [[T3, 1, 1], [T3, 1, a]]));
    return { tracks, duration: C84 };
  }
  if (N === 3) {
    return {
      tracks: [
        list(head(0), 0, 1, [[T3, 1, a], [C84, 0, a], [T3, 1, 1]]),
        list(head(1), 0, a, [[T3, 1, 1], [T3, 1, a], [T3, 1, 1], [T3, 1, a]]),
        list(head(2), T3, a, [[T3, 1, 1], [T3, 1, a]]),
      ],
      duration: K43,
    };
  }
  const t = T3 + (2 * N - 8) * K60;
  const Db = 2 * (t + (N - 2) * K12);
  const s = K524 / Db;
  const F = (2.5 * t) / Db;
  const h = K512 / Db;
  const tracks: Track[] = [];
  for (let i = 0; i < N; i++) {
    const start = Math.max(i - 1, 0) * s;
    if (i === 0) tracks.push(list(head(i), start, 1, [[F, 1, a], [h * (N - 2), 0, a], [s, 1, 1]]));
    else if (i < N - 1) tracks.push(list(head(i), start, a, [[s, 1, 1], [F, 1, a], [h * (N - 2 - i), 0, a], [s, 1, 1], [F, 1, a]]));
    else tracks.push(list(head(i), start, a, [[s, 1, 1], [F - s, 0, 1], [F, 1, a]]));
  }
  return { tracks, duration: 2.5 };
}

/**
 * 07 §9.5 the wave (`vc_sequential` with option bit 6: iterative, not reversing, `vcContinuous`),
 * n ≥ 1: one header (0x00100408) on every threshold layer, `a →(r,c1)→ 1 →(f,c1)→ a` with `r`, `f`
 * as iterative with N = n; rank k's clock is delayed by `k·r` after the intro (07 §4.6
 * `layer_delay`); period `n·r`, i.e. `n/3` (n ≤ 3) or `(n/9)/Dn`. Where the list outlasts the
 * period (n = 1, 4, 5) each cycle cuts its decay short.
 */
export function vcWave(n: number, a: number): Omit<VcCycle, "gap"> & { delay: number[] } {
  let r = T3;
  let fall = T3;
  let duration = n * T3;
  if (n > 3) {
    const { t, Dn } = waveUnits(n);
    r = K9 / Dn;
    fall = (K43 * t) / Dn;
    duration = (n * K9) / Dn;
  }
  const track = list({ property: "variableAlpha", filter: FILTER.hasThreshold }, 0, a, [[r, 1, 1], [fall, 1, a]]);
  // `layer_delay`: rank k after the intro by k·r; index 0 (no threshold) is not delayed.
  const delay = Array.from({ length: n + 1 }, (_, k) => (n <= 3 ? k * T3 : (k * K9) / waveUnits(n).Dn));
  return { tracks: [track], duration, delay };
}

/**
 * 07 §9.5: the loop phase of the animated form for `n` distinct thresholds, by fill and
 * reversing, with the symbol's `vcContinuous`; `a` the inactive alpha. The repeat gap is 1/3 for
 * cumulative, cumulative reversing and iterative, 0 for iterative reversing and the wave.
 * [INF] Iterative with `vcContinuous` and n = 0 would be a wave of period 0: it is iterative's n = 0
 * form (`alpha`, `a → 1 → a`, duration 2/3) with the wave's gap 0.
 */
export function vcCycle(
  n: number,
  fill: Spec["vcFill"],
  reversing: boolean,
  continuous: boolean,
  a: number,
): VcCycle {
  if (fill === "cumulative") return { ...(reversing ? vcCumulativeReversing(n, a) : vcCumulative(n, a)), gap: T3 };
  if (reversing) return { ...vcIterativeReversing(n, continuous, a), gap: 0 };
  if (!continuous) return { ...vcIterative(n, false, a), gap: T3 };
  if (n === 0) return { ...vcIterative(0, false, a), gap: 0 };
  return { ...vcWave(n, a), gap: 0 };
}

/**
 * 07 §9.5: the inactive alpha `a`: 0 when hidden (option bit 29), else `Model::alpha(2)` in
 * hierarchical mode (07 §2.7), else float32 `0.30000001192092896`.
 */
export function vcInactiveAlpha(spec: Spec): number {
  if (spec.vcInactive === "hide") return 0;
  return spec.renderingMode === "hierarchical" ? levelAlpha(spec.appearance, 2) : INACTIVE;
}

/** 07 §9.5 `vc_intro_outro`: header 0x0010040A, `variable-alpha-fade` on the threshold layers. */
const fade = (from: number, to: number): Track => ({
  property: "variableAlphaFade",
  filter: FILTER.hasThreshold,
  start: 0,
  from,
  segments: [{ duration: T3, curve: 1, to }],
});

/**
 * Variable Color (07 §9). With `variableValue`, the static form (07 §9.2–§9.3): the value is a
 * position, not a time, so every track is a constant. Colour mode: an `alpha` per layer with a
 * threshold, 1 when active and 0.3 when not. Draw mode: a `stroke-end` per layer, which is the Draw
 * range `[0, fraction]` on a strokable layer and `alpha *= fraction` on any other (07 §2.3, §9.3).
 *
 * Without it, the animated form (07 §9.5): the intro `0 →(1/3,c1)→ 1` of `variable-alpha-fade`
 * on the threshold layers, the cycle of `vcCycle`, the gap, the outro `1 →(1/3,c1)→ 0`. Once: one
 * cycle, the gap, then the outro (a counted loop). Continuous: the cycle repeats every
 * `D + speed · gap` effect seconds, so the gap lasts `gap` wall-clock seconds at any speed;
 * stopped, it finishes the cycle and plays the outro. The wave runs each threshold rank on its own
 * clock (`clock: "rank"`). Motion groups and `byLayer` do not apply.
 */
export function variableColorPlan(d: AnimDrawing, spec: Spec): Plan {
  if (spec.variableValue === undefined) return animatedPlan(d, spec);
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

function animatedPlan(d: AnimDrawing, spec: Spec): Plan {
  const a = vcInactiveAlpha(spec);
  const cycle = vcCycle(d.rankCount, spec.vcFill, spec.vcReversing, d.vcContinuous, a);
  const plan: Plan = {
    tracks: [fade(0, 1)],
    // The gap is wall-clock seconds: the sampler adds `speed · gap` to the cycle (07 §6.2 step 5).
    loop: { tracks: cycle.tracks, period: cycle.duration, gap: cycle.gap, ...(spec.repeat === "once" ? { count: 1 } : {}) },
    outro: { tracks: [fade(1, 0)] },
    inactiveAlpha: () => a,
  };
  if (cycle.delay) {
    plan.clock = "rank";
    plan.groupDelay = cycle.delay;
  }
  return plan;
}
