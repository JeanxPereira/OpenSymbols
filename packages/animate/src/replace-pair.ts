import type { AnimDrawing, AnimLayer } from "./drawing.js";
import { CLIP_TAIL, drawDurationUnchained, layerDrawDuration } from "./effects/draw-timing.js";
import { replaceInTracks, replaceOutTracks } from "./effects/replace.js";
import { FILTER, LAYER_FLAG, type Filter, type Track } from "./keyframes.js";
import { checkSpeed, duration, planSpan, sample, samplePlan, specKey, type Plan } from "./sample.js";
import type { LayerState, Spec } from "./spec.js";

const f = Math.fround;

/**
 * A Magic Replace subtype (07 §7.10), in RenderBox's numbering: 0 slash add, 1 slash remove,
 * 2 badge add, 3 badge remove, 4 badge move, 5–7 draw.
 */
export type ReplaceSubtype = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ---- constants (07 §7.10; float32, 07 §2.8) ----

/** The slash and badge tables' durations, as stored. */
const THIRD = f(0.3333333432674408);
const D22 = f(0.2199999988079071);
const D26 = f(0.25999999046325684);
const D217 = f(0.21699999272823334);
const D266 = f(0.26600000262260437);
const D167 = f(0.16699999570846558);
const D05 = f(0.05000000074505806);
/** The tables' values (0x1A7960D70 …). */
const V108 = f(1.08);
const V105 = f(1.05);
const V097 = f(0.97);
const V0959 = f(0.959);
const V095 = f(0.95);
const V1059 = f(1.059);
/** Durations (0x1A789C578): slash add, slash remove, badge. */
const TOTAL_SLASH_ADD = f(0.6666666865348816);
const TOTAL_SLASH_REMOVE = f(0.699999988079071);
const TOTAL_BADGE = 1;
/** Draw subtypes: the cross-fade `0.083` = `0.08299999684` (0x1A7960C88), and style 2's `1/12`. */
const F083 = f(0.08299999684);
const TWELFTH = f(1 / 12);
/** 07 §7.10 `s8`'s base and the in half's span: 0.25. */
const BASE = 0.25;
/** 07 §7.8 Draw Off's plateau `1 − 1e-4`, stored as `0.99989998` (07 §2.8). */
const PLATEAU = f(0.9999);

const SRC = LAYER_FLAG.sourceSide;
const DST = LAYER_FLAG.destinationSide;
const ENCLOSURE_TAGS = new Set(["_enclosure.stroke", "_enclosure.fill"]);

// ---- inferring the subtype (07 §7.10 steps 1–5) ----

const has = (d: AnimDrawing, flag: number): boolean => d.layers.some((l) => (l.flags & flag) !== 0);

/**
 * 07 §7.10 "Comparing tags" [INF]: drop a tag equal to either glyph's name or extending its own
 * glyph's name with a dotted suffix.
 */
function keepTag(tag: string, own: AnimDrawing, other: AnimDrawing): boolean {
  if (tag === own.name || tag === other.name) return false;
  return !(own.name !== undefined && tag.startsWith(`${own.name}.`));
}

/** The name-filtered union of the tags of `own`'s layers that `pick` selects. */
function tagSet(own: AnimDrawing, other: AnimDrawing, pick: (l: AnimLayer) => boolean): Set<string> {
  const out = new Set<string>();
  for (const l of own.layers) if (pick(l)) for (const t of l.tags) if (keepTag(t, own, other)) out.add(t);
  return out;
}

const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/** Tags outside (`inside = false`) or inside the layers carrying `flag`, both glyphs, compared. */
function sameTags(from: AnimDrawing, to: AnimDrawing, flag: number, inside: boolean): boolean {
  const pick = (l: AnimLayer) => ((l.flags & flag) !== 0) === inside;
  return sameSet(tagSet(from, to, pick), tagSet(to, from, pick));
}

/**
 * 07 §7.10 `infer_replace_subtype`: the Magic Replace subtype of `from → to`, or undefined for the
 * plain Replace. Step 1's preconditions (point size, size, weight, rendering mode) hold by
 * construction: the caller renders both drawings at one of each, so the model checks none. Option bits 27–29 are all on (the default
 * word); the model offers no way to clear them.
 */
export function replaceSubtype(from: AnimDrawing, to: AnimDrawing): ReplaceSubtype | undefined {
  const { slash, badge, enclosure, stroke } = LAYER_FLAG;
  // Step 2, slash: the tags outside the slash layers agree.
  const slashFrom = has(from, slash);
  const slashTo = has(to, slash);
  if ((slashFrom || slashTo) && sameTags(from, to, slash, false)) {
    if (slashFrom && !slashTo) return 1;
    if (!slashFrom && slashTo) return 0;
  }
  // Step 3, badge: the non-badge tags agree.
  const badgeFrom = has(from, badge);
  const badgeTo = has(to, badge);
  if ((badgeFrom || badgeTo) && sameTags(from, to, badge, false)) {
    if (badgeFrom && !badgeTo) return 3;
    if (!badgeFrom && badgeTo) return 2;
    if (badgeFrom && badgeTo && !sameTags(from, to, badge, true)) return 4;
  }
  // Step 4, draw: some layer of either glyph is an enclosure or animates its stroke.
  if (has(from, enclosure | stroke) || has(to, enclosure | stroke)) {
    const ea = from.layers.filter((l) => l.flags & enclosure);
    const eb = to.layers.filter((l) => l.flags & enclosure);
    // [INF] "every pair of enclosure layers": the most any pair shares decides.
    let one = false;
    for (const a of ea) {
      for (const b of eb) {
        const common = a.tags.filter((t, i) => b.tags.includes(t) && a.tags.indexOf(t) === i);
        if (common.length > 1) return 7;
        if (common.length === 1 && !ENCLOSURE_TAGS.has(common[0]!)) one = true;
      }
    }
    if (one) return 6;
    if (has(from, stroke) || has(to, stroke)) return 5;
  }
  // Step 5.
  return undefined;
}

// ---- the plans ----

interface Pair {
  out: Plan;
  in: Plan;
}

/** A filter restricted to one side of the pair (07 §2.2 side bits). */
const side = (flt: Filter, s: number): Filter => ({ mask: flt.mask | s, value: flt.value | s });

/**
 * [INF] (07 §7.10): a source layer the subtype's tables do not reach — not `flag` — is hidden;
 * both glyphs agree on that content, so the destination draws it once.
 */
const hideSourceOutside = (flag: number): Track => ({
  property: "clipAlpha",
  filter: { mask: flag | SRC, value: SRC },
  start: 0,
  from: 0,
  segments: [],
});

/** 07 §7.10 the slash and badge tables: one plan, both glyphs, the side bits picking a side. */
function tablePlan(sub: 0 | 1 | 2 | 3 | 4): Plan {
  const { slash, badge } = LAYER_FLAG;
  switch (sub) {
    case 0:
      return {
        tracks: [
          { property: "strokeEnd", filter: FILTER.slash, start: 0, from: 0, segments: [{ duration: THIRD, curve: 25, to: V108 }, { duration: THIRD, curve: 26, to: 1 }] },
          hideSourceOutside(slash),
        ],
        total: TOTAL_SLASH_ADD,
      };
    case 1:
      return {
        tracks: [
          { property: "strokeEnd", filter: FILTER.slash, start: 0, from: 1, segments: [{ duration: BASE, curve: 30, to: 0 }] },
          {
            property: "scale",
            start: 0,
            from: 1,
            segments: [
              { duration: D22, curve: 27, to: V105 },
              { duration: D22, curve: 28, to: V097 },
              { duration: D26, curve: 29, to: 1 },
            ],
          },
          hideSourceOutside(slash),
        ],
        total: TOTAL_SLASH_REMOVE,
      };
    case 2:
      return {
        tracks: [
          {
            property: "scale",
            start: D05,
            from: 1,
            segments: [
              { duration: D217, curve: 37, to: V105 },
              { duration: D217, curve: 38, to: V0959 },
              { duration: D266, curve: 39, to: 1 },
            ],
          },
          { property: "scaleBadge", filter: FILTER.badge, start: 0, from: 0.75, segments: [{ duration: BASE, curve: 31, to: 1 }] },
          { property: "clipAlpha", filter: FILTER.badge, start: 0, from: 0, segments: [{ duration: BASE, curve: 32, to: 1 }] },
          hideSourceOutside(badge),
        ],
        total: TOTAL_BADGE,
      };
    case 3:
    case 4: {
      const scale: Track = {
        property: "scale",
        start: sub === 4 ? D05 : 0,
        from: 1,
        segments: [
          { duration: D217, curve: 37, to: V095 },
          { duration: D217, curve: 38, to: V1059 },
          { duration: D266, curve: 39, to: 1 },
        ],
      };
      const badgeTracks: Track[] =
        sub === 3
          ? [
              { property: "scaleBadge", filter: FILTER.badge, start: 0, from: 1, segments: [{ duration: D167, curve: 33, to: 0.75 }] },
              { property: "clipAlpha", filter: FILTER.badge, start: 0, from: 1, segments: [{ duration: D167, curve: 34, to: 0 }] },
            ]
          : [
              { property: "scaleBadge", filter: side(FILTER.badge, SRC), start: 0, from: 1, segments: [{ duration: BASE, curve: 35, to: 0.5 }] },
              { property: "scaleBadge", filter: side(FILTER.badge, DST), start: BASE, from: 0.5, segments: [{ duration: BASE, curve: 36, to: 1 }] },
              { property: "clipAlpha", filter: side(FILTER.badge, SRC), start: BASE, from: 1, segments: [{ duration: 0, curve: 0, to: 0 }] },
              { property: "clipAlpha", filter: side(FILTER.badge, DST), start: BASE, from: 0, segments: [{ duration: 0, curve: 0, to: 1 }] },
            ];
      return { tracks: [scale, ...badgeTracks, hideSourceOutside(badge)], total: TOTAL_BADGE };
    }
  }
}

/**
 * 07 §7.10 draw subtypes 5–7 (`replace_draw_keyframes`), with 07 §7.8's Draw at option bit 29 only:
 * no chain (every layer starts together, its own duration), bit 29 hiding a layer before its On and
 * after its Off. The stroke range is left in `LayerState.strokeStart/strokeEnd/strokeClip` for the
 * clip (08) to cut; riders read `attachmentScale`.
 */
function drawPlans(from: AnimDrawing, to: AnimDrawing, spec: Spec, sub: 5 | 6 | 7): Pair {
  const enclosed = sub !== 5;
  // 6 and 7: the enclosure layers take no part (filter mask 8, value 0); 5: mask 0.
  const admit = (l: AnimLayer) => !enclosed || (l.flags & LAYER_FLAG.enclosure) === 0;
  const mask = enclosed ? FILTER.notEnclosure : undefined;
  const notStroke = enclosed ? FILTER.notStrokeOrEnclosure : FILTER.notStroke;
  const style = spec.replaceStyle;
  const src = from.layers.filter(admit);
  const dst = to.layers.filter(admit);

  // s8 = draw_duration(source, Off, options 0, base 0.25, mask); 0 in style 3; a source of only
  // enclosure layers gives 0.083 (6) or 0 (7).
  const s8 = style === "offUp" ? 0 : enclosed && src.length === 0 ? (sub === 6 ? F083 : 0) : drawDurationUnchained(src, BASE, true);
  const on = drawDurationUnchained(dst, BASE, false);
  // Duration (0x1A789C690): max(off, f) + max(on, f), f = 0.083 in 6, else 0; style 3: the off
  // half counts 0 and the floor is 0.083, so max(on, 0.083).
  const floor = sub === 6 ? F083 : 0;
  const total = style === "offUp" ? Math.max(on, F083) : Math.max(s8, floor) + Math.max(on, floor);

  // Source.
  const out: Track[] = [];
  if (style === "offUp") {
    out.push({ property: "clipAlpha", ...(mask ? { filter: mask } : {}), start: 0, from: 1, segments: [{ duration: F083, curve: 1, to: 0 }] });
  } else if (src.some((l) => l.strokable)) {
    from.layers.forEach((l, layer) => {
      if (!admit(l) || !l.strokable) return;
      const dur = layerDrawDuration(l);
      // Draw Off on a clipping layer: stroke-start on curve 18 with the 1/30 plateau, the rider scale, bit 29's clip-alpha.
      out.push(
        { property: "strokeStart", layer, start: 0, from: 0, segments: [{ duration: dur, curve: 18, to: PLATEAU }, { duration: CLIP_TAIL, curve: 0, to: PLATEAU }, { duration: 0, curve: 0, to: 1 }] },
        { property: "attachmentScale", layer, start: dur, from: 1, segments: [{ duration: CLIP_TAIL, curve: 0, to: 0.5 }, { duration: 0, curve: 0, to: 0 }] },
        { property: "clipAlpha", layer, start: dur + CLIP_TAIL, from: 1, segments: [{ duration: 0, curve: 0, to: 0 }] },
      );
    });
    out.push(...replaceOutTracks(from, spec, notStroke));
  } else out.push(...replaceOutTracks(from, spec, mask));

  // Destination: Draw On from s8, the in half from s8 (s8 − 1/12 in style 2).
  const inn: Track[] = [];
  // [INF] clamped at 0: a negative start is not representable on a track (07 §7.10).
  const s0 = style === "upUp" ? Math.max(s8 - TWELFTH, 0) : s8;
  if (dst.some((l) => l.strokable)) {
    to.layers.forEach((l, layer) => {
      if (!admit(l) || !l.strokable) return;
      inn.push(
        { property: "strokeEnd", layer, start: s8, from: 0, segments: [{ duration: layerDrawDuration(l), curve: 17, to: 1 }] },
        { property: "clipAlpha", layer, start: s8, from: 0, segments: [{ duration: 0, curve: 0, to: 1 }] },
      );
    });
    inn.push(...replaceInTracks(to, spec, s0, notStroke));
  } else inn.push(...replaceInTracks(to, spec, s0, mask));

  if (sub === 6) {
    // The enclosures cross-fade.
    out.push({ property: "clipAlpha", filter: FILTER.enclosure, start: Math.max(s8, F083), from: 1, segments: [{ duration: F083, curve: 1, to: 0 }] });
    inn.push({
      property: "clipAlpha",
      filter: FILTER.enclosure,
      start: Math.max(s8 - F083, 0),
      from: 0,
      segments: [{ duration: 0, curve: 0, to: 0 }, { duration: F083, curve: 1, to: 1 }],
    });
  } else if (sub === 7) {
    // [INF] no keyframes on either side: the source's copy is hidden, the destination draws it once.
    out.push({ property: "clipAlpha", filter: FILTER.enclosure, start: 0, from: 0, segments: [] });
  }
  return { out: { tracks: out, total }, in: { tracks: inn, total } };
}

// ---- the pair ----

interface Entry {
  sub: ReplaceSubtype | undefined;
  pair?: Pair;
}

const cache = new WeakMap<AnimDrawing, WeakMap<AnimDrawing, Map<string, Entry>>>();

function entry(from: AnimDrawing, to: AnimDrawing, spec: Spec): Entry {
  let byTo = cache.get(from);
  if (!byTo) cache.set(from, (byTo = new WeakMap()));
  let bySpec = byTo.get(to);
  if (!bySpec) byTo.set(to, (bySpec = new Map()));
  const key = specKey({ ...spec, replaceHalf: "out" });
  const hit = bySpec.get(key);
  if (hit) return hit;
  const sub = spec.kind === "magicReplace" ? replaceSubtype(from, to) : undefined;
  const e: Entry = { sub };
  if (sub !== undefined) {
    if (sub <= 4) {
      const p = tablePlan(sub as 0 | 1 | 2 | 3 | 4);
      e.pair = { out: p, in: p };
    } else e.pair = drawPlans(from, to, spec, sub as 5 | 6 | 7);
  }
  if (bySpec.size >= 16) bySpec.clear();
  bySpec.set(key, e);
  return e;
}

function checkKind(spec: Spec): void {
  if (spec.kind !== "replace" && spec.kind !== "magicReplace") {
    throw new RangeError(`replacePair needs kind "replace" or "magicReplace", got "${String(spec.kind)}"`);
  }
}

/**
 * A Replace pair at `t` seconds (07 §7.9, §7.10): `out` for `from`'s layers (the source, indexed
 * like `from.layers`), `in` for `to`'s (the destination, like `to.layers`), on one clock. With kind
 * `magicReplace` the subtype is inferred from both drawings; with none it is the plain Replace.
 * The two drawings' layers never need to correspond: any layer counts are fine.
 */
export function replacePair(from: AnimDrawing, to: AnimDrawing, spec: Spec, t: number): { out: LayerState[]; in: LayerState[] } {
  return replacePairIn(from, to, spec, spec.renderingMode, t);
}

/**
 * Internal (the React `<Replace>`): `replacePair` with the destination sampled in `inMode` and the
 * source in `spec.renderingMode`, each half in the mode its own icon is drawn in (the eraser flag
 * of 07 §2.2 is per mode). The pair's plans do not depend on the mode.
 */
export function replacePairIn(
  from: AnimDrawing,
  to: AnimDrawing,
  spec: Spec,
  inMode: Spec["renderingMode"],
  t: number,
): { out: LayerState[]; in: LayerState[] } {
  checkKind(spec);
  const outSpec: Spec = { ...spec, replaceHalf: "out" };
  const inSpec: Spec = { ...spec, replaceHalf: "in", renderingMode: inMode };
  const { pair } = entry(from, to, spec);
  if (!pair) return { out: sample(from, outSpec, t), in: sample(to, inSpec, t) };
  return { out: samplePlan(from, pair.out, outSpec, t), in: samplePlan(to, pair.in, inSpec, t) };
}

/** The pair's duration in seconds (07 §5): the longer half, or the subtype's total, divided by speed. */
export function replaceDuration(from: AnimDrawing, to: AnimDrawing, spec: Spec): number {
  checkKind(spec);
  checkSpeed(spec.speed);
  const { pair } = entry(from, to, spec);
  if (!pair) return Math.max(duration(from, { ...spec, replaceHalf: "out" }), duration(to, { ...spec, replaceHalf: "in" }));
  const span = Math.max(planSpan(pair.out), planSpan(pair.in));
  return (span > 0 ? span : 1) / spec.speed;
}
