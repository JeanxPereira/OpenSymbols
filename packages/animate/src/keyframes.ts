import { curve } from "./curves.js";

/**
 * The layer properties a track drives (Docs/format/07 §2.3; RenderBox property id in brackets).
 * The variable-alpha family (8–10) acts on a per-layer `vAlpha` that starts at 1 and multiplies
 * the layer's alpha (07 §2.3, §9.5); 11 (`variable-alpha-interpolant`) is not offered.
 */
export type Property =
  | "alpha" // 1: alpha *= v
  | "scale" // 2: scale = k · v (k = 1 at scale level 0, 07 §2.4)
  | "scaleInterpolant" // 3: scale = s + (k − s) · v, with `interp = [s, k]`
  | "scaleBadge" // 4: badgeScale = v
  | "translation" // 5: offset += dir · v (07 §2.6)
  | "symbolRotation" // 6: symbolTurn += v (radians)
  | "layerRotation" // 7: layerTurn += v (radians)
  | "variableAlpha" // 8: vAlpha = v
  | "variableAlphaMax" // 9: vAlpha = max(vAlpha, v)
  | "variableAlphaFade" // 10: vAlpha += (a − vAlpha) · v, a the inactive alpha (07 §9.5)
  | "pulseAlpha" // 12: alpha *= floor + (1 − floor) · v
  | "clipAlpha" // 13: alpha *= v; v ≤ 0 hides
  | "strokeStart" // 14: the clip start, or alpha *= 1 − v on a non-strokable layer
  | "strokeEnd" // 15: the clip end, or alpha *= v on a non-strokable layer
  | "attachmentScale"; // 16: the rider scale (08 §11.5)

/** A header's layer filter (07 §2.2): admits a layer when `((flags | side) ^ value) & mask == 0`. */
export interface Filter {
  mask: number;
  value: number;
}

/** Model layer flags, at RenderBox's bit positions (07 §2.2 "Layer flags"; side bits 0x100/0x200). */
export const LAYER_FLAG = {
  eraser: 0x1,
  slash: 0x2,
  badge: 0x4,
  enclosure: 0x8,
  stroke: 0x10,
  /** A finite `variableThreshold` (07 §2.2, §9.5): the layer has a threshold rank. */
  hasThreshold: 0x20,
  alwaysPulses: 0x40,
  alwaysRotates: 0x80,
  sourceSide: 0x100,
  destinationSide: 0x200,
} as const;

/** The named filters of 07 §2.2. */
export const FILTER = {
  any: { mask: 0, value: 0 },
  alwaysRotates: { mask: 0x80, value: 0x80 },
  alwaysPulses: { mask: 0x41, value: 0x40 },
  slash: { mask: 0x2, value: 0x2 },
  badge: { mask: 0x4, value: 0x4 },
  enclosure: { mask: 0x8, value: 0x8 },
  notEnclosure: { mask: 0x8, value: 0 },
  notStroke: { mask: 0x11, value: 0 },
  /** 07 §2.2 `notStroke` with the enclosure bit (+0x8): Magic Replace subtypes 6 and 7 (07 §7.10). */
  notStrokeOrEnclosure: { mask: 0x19, value: 0 },
  /** Layers with a finite threshold (flag 0x20): Variable Color's intro, outro and wave (07 §9.5). */
  hasThreshold: { mask: 0x20, value: 0x20 },
} as const satisfies Record<string, Filter>;

/** `from → to` over `duration` seconds on `curve` (07 §2.1). */
export interface Segment {
  duration: number;
  curve: number;
  to: number;
}

/**
 * A keyframe list (07 §2.1 "the model"): `{property, group, layer, rank, filter, start, from, segments}`.
 * `group` (index mode 1, the compacted motion group, 07 §4.1), `layer` (index mode 2) or `rank`
 * (index mode 3, the threshold rank, 07 §2.2, §9.5) narrow the layers reached; none means every
 * layer (mode 0).
 */
export interface Track {
  property: Property;
  start: number;
  from: number;
  segments: Segment[];
  group?: number;
  layer?: number;
  /** Index mode 3: the layer's threshold rank (`AnimLayer.rank`, 1 … n) equals it. */
  rank?: number;
  filter?: Filter;
  /** `scaleInterpolant` only: `[s, k]`, the origin and destination factors (07 §2.3, §7.6). */
  interp?: [number, number];
  /** `translation` only: the unit vector in output space, y down (07 §2.6, §7.4). */
  dir?: [number, number];
}

/** The instant the track reaches its last value. */
export function trackEnd(track: Track): number {
  let end = track.start;
  for (const s of track.segments) end += Math.max(s.duration, 0);
  return end;
}

/**
 * The track's value at `t` (07 §2.1 [INF]): `from` before `start` or for a non-finite `t`; a
 * zero-duration segment has already jumped at its own instant (right-continuous); past the last
 * segment, its `to`.
 */
export function evalTrack(track: Track, t: number): number {
  if (!Number.isFinite(t) || t < track.start) return track.from;
  let local = t - track.start;
  let prev = track.from;
  for (const seg of track.segments) {
    // 07 §2.1: `push_value` stores `max(duration, 0)`.
    const d = Math.max(seg.duration, 0);
    if (local < d) return prev + (seg.to - prev) * curve(seg.curve)(local / d);
    local -= d;
    prev = seg.to;
  }
  return prev;
}
