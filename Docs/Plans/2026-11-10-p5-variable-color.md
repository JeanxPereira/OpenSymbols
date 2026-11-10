# P5 — Variable Color, the animated forms

**Plan 5 of 5.** P4 shipped static Variable Color only (07 §9.2–§9.4). This plan adds the
animated forms: cumulative and iterative, each reversing or not, inactive layers dimmed or
hidden, with the intro and outro, the repeat gap and the continuous wave that
`vcContinuous` turns on.

The timing was read in RenderBox 26A5416b (`vc_*_keyframes`, `local_duration`, `layer_delay`,
`Animation::keyframes`, `description`, `local_time`, the property handlers) and the option
mapping in Symbols 26A5416b (`_rbOptionsMutable`). Task 1 writes those facts into
`Docs/format/07-effects.md`; Tasks 2 and 3 implement from the same facts.

## The contract (committed before the tasks)

`Spec` (`packages/animate/src/spec.ts`):

- `variableValue?: number`: present → the static form (unchanged); absent → the animated form.
- `vcFill: "cumulative" | "iterative"` (option bit 31), default `"cumulative"`.
- `vcReversing: boolean` (bit 30), default `false`.
- `vcInactive: "dim" | "hide"` (bit 29), default `"dim"`.

`EffectProps` (`packages/react/src/effects.ts`): `{ kind: "variableColor"; variableValue?;
fill?; reversing?; inactive?; speed?; byLayer?; repeat? }`.

Defaults are RenderBox's: no option bit set is cumulative, non-reversing, dim. What the Swift
layer passes by default for `.variableColor` was not read.

## Behaviour (what Tasks 2 and 3 implement)

Notation: `k` is a layer's **threshold rank**, the dense 1-based rank of its
`variableThreshold` among the distinct thresholds of the drawing, ascending (equal thresholds
share a rank); `n` is the number of distinct thresholds. Layers without a threshold have rank
−1 and are never reached by a rank-indexed track. `a` is the inactive alpha: 0 when hidden,
else the hierarchy's level-2 alpha in hierarchical mode, else `Math.fround(0.3)`. Curves are
RenderBox ids (c1 = the 0.33/0.67 ease, c0 = linear). `v0 →(d, c)→ v1` is one segment.

Properties, applied to a per-layer `vAlpha` that starts at 1 and multiplies the layer's alpha:
8 `variableAlpha` assigns `vAlpha = v`; 9 `variableAlphaMax` sets `vAlpha = max(vAlpha, v)`;
10 `variableAlphaFade` sets `vAlpha += (a − vAlpha) · v`. Tracks apply in plan order.

Phases: **intro** 1/3 s, one property-10 track on every layer with a threshold (layer flag
0x20): `0 →(1/3, c1)→ 1`. **Cycle** of duration `D`, built by the style below. **Gap**: the
cycle's last values hold for `gap` = 1/3 s (cumulative, cumulative reversing, iterative), 0
(iterative reversing, and the wave), in wall-clock seconds: speed does not shorten it. **Outro** 1/3 s, property 10: `1 →(1/3, c1)→ 0`.
`repeat: "once"`: intro, one cycle, the gap, the outro. `"continuous"`: intro, then the cycle
looping with period `D/speed + gap`; stopping finishes the cycle and plays the outro.

Cycles (loop phase, times from the start of the cycle):

- **cumulative** (`D` = 1, 4/3, 5/3 for n = 1, 2, ≥ 3): `s = 1/3` for n ≤ 3, else
  `Math.fround(0.6666666269302368) / (n − 1)`; `E = Math.fround(2/3)` for n = 2, else 1. Layer
  rank k (i = k − 1), start `i·s`: `a →(1/3,c1)→ 1 →(E − i·s, c0)→ 1 →(1/3,c1)→ a`.
- **cumulative reversing** (`D` = 1 + 2s(n − 1)): same `s`; start `i·s`:
  `a →(1/3,c1)→ 1 →(2s(n−1−i) + 1/3, c0)→ 1 →(1/3,c1)→ a`.
- n = 1 for both cumulative forms: `a →(1/3,c1)→ 1 →(1/3,c0)→ 1 →(1/3,c1)→ a` on rank 1.
- **iterative** (`N = n + 1` when `vcContinuous` and not the wave, else `n`): one shared value
  list `a →(r, c1)→ 1 →(f, c1)→ a` on ranks 1 … N with start `(k−1)·r`. N ≤ 3: `r = f = 1/3`,
  `D = (N+1)/3`. N > 3: `t = 1/3 + (2N−8)/60`, `Dn = t + N/12`, `r = (1/9)/Dn`,
  `f = (4/3)·t/Dn`, `D = 4/3`. With the +1, the track of rank N is property 9 on rank 1 (the
  wave wraps to its start).
- **iterative reversing** (`N = n + (vcContinuous ? 1 : 0)`): the per-rank lists of the facts
  file §2.5 for N ≤ 2, N = 3 and N > 3 (`D` = 2/3, 4/3, 2.5).
- **the wave** (iterative, not reversing, `vcContinuous`; Apple's option bit 6): one track on
  every threshold layer, `a →(r, c1)→ 1 →(f, c1)→ a` with `r`, `f` as for iterative with N = n,
  each rank on its own clock delayed by `k·r` after the intro; period `n/3` (n ≤ 3) or
  `(n/9)/Dn` (n > 3), no gap.
- **n = 0** (no layer has a threshold): each style's own n = 0 form, on property 1 `alpha` on
  every layer (07 §9.5 table). The wave has a zero period at n = 0, so iterative with
  `vcContinuous` plays plain iterative there.

Motion groups, `byLayer` and `drawReversesMotionGroups` do not apply to Variable Color.

## Tasks

The three tasks write disjoint files and run in parallel, each in its own worktree. They all
read `Docs/format/07-effects.md` (§2, §4.6, §6, §8, §9) and the facts file named in their brief.

### Task 1 — Docs (`Docs/format/07-effects.md`, `Docs/Specs/2026-11-09-opensymbols-design.md`)

- §2.2: index mode 3 reads the threshold rank; layer flag 0x20 "has a finite threshold".
- §2.3: handlers of properties 8, 9, 10, 11 as read.
- §4.6 and §9.5: kind 1's `layer_delay` uses the threshold rank, only under option bit 6;
  remove the "stagger by motion group" claim.
- §8.1 / §8.3: bits 31, 30, 29, 28 (`variableColorContinuous`, from the catalog's
  `vcContinuous`), 6 (set by `description`); the Symbols packing; the new `Spec` fields.
- §9.4: kind 0 drives property 11 (headers 0x0010040B / 0x0008020B).
- §9.5 rewritten as "The animated forms" with the closed forms, durations, phases and gap, and
  the n = 3 and n = 6 timelines; §9.6 keeps only what is still open.
- Spec §9.2 / §11: Variable Color's animated forms are in.
- Every statement keeps its seal and address. No mention of where the binaries came from.

### Task 2 — Engine (`packages/animate/src`: `keyframes.ts`, `drawing.ts`, `sample.ts`, `effects/variable-color.ts`, tests)

- `AnimLayer.rank` and `AnimDrawing.rankCount`; `LAYER_FLAG.hasThreshold = 0x20` set on
  layers with a finite threshold; `Track.rank` (index mode 3).
- Properties `variableAlpha`, `variableAlphaMax`, `variableAlphaFade` with `vAlpha`; the
  inactive alpha as above.
- `Plan.clock?: "group" | "rank"`: with `"rank"` the clock index is `max(rank, 0)` and
  `groupDelay` is indexed by it (stop and `cycleEnds` follow the same clocks).
- `variableColorPlan`: static form unchanged when `variableValue` is present; else the
  animated form above, once and continuous, with `duration()` = `D + gap` per cycle.
- Tests: every closed form against the facts file's n = 3 and n = 6 timelines (sampled values
  at the listed instants), the `local_duration` table for n = 0 … 8, intro and outro, hide and
  hierarchical, the wave's per-rank clocks, stop finishing the cycle then the outro, no NaN.

### Task 3 — React and demo (`packages/animate/src/react/use-effect.ts`, `apps/demo`, `README.md`)

- `toSpec` maps `fill`, `reversing`, `inactive`; `variableValue` stays the static switch.
- Demo animation panel: Variable Color offers "animated" or "value" (slider), and for animated
  the fill, reversing and inactive choices; the copy literal and JSX carry the non-default
  options in a stable key order.
- README: the effects section documents the Variable Color options.
- Tests: `toSpec` mapping, the panel's controls and the copied literal.

## Integration

Merge the three branches into `p5-variable-color`, then run `pnpm test` with and without
`SF_CATALOG_DIR`, the typecheck and `pnpm check:pack`; a final whole-branch review; a visual
check on real symbols (`wifi`, `speaker.wave.3`, `touchid`) with Playwright; squash to `main`.
