import { viewBoxToPath } from "@opensymbols/core";
import type { AnimDrawing, StrokeAttachment } from "../drawing.js";
import type { LayerState, Matrix } from "../spec.js";
import { clipContours, prepare, type CapRecord } from "./cut.js";
import { PathWriter, pointAt, wrap, type Loop } from "./length.js";

const f = Math.fround;
/** 08 §11.2 / §11.4: `1e-4` as float32 `9.99999974e-05` (07 §2.8). */
const EPS = f(1e-4);
/** 08 §11.4: a span below `0.9999` hides the rider unless the progress rule says otherwise. */
const FULL = f(0.9999);
/** 08 §11.5: the head grows from half size over the first 0.2 point sizes of travel past `b`. */
const GROW = f(0.2);
/** 08 §11.1 `ClipStrokeAttachmentFlags`. */
const IGNORE_TRANSLATION = 1;
const IGNORE_ROTATION = 2;
const HAS_START_PROGRESS = 4;

interface Site {
  layer: number;
  local: number;
}

interface Family {
  layers: number[];
  /** First family subpath of each layer (08 §11.1: numbered per family layer, across its nodes in document order). */
  offsets: number[];
  counts: number[];
}

interface Hook {
  /** The record's index in the target layer's `strokeKeyframes`. */
  id: number;
  P0: [number, number];
  P1: [number, number];
}

interface Resolved {
  /** Family number → its layers; a layer with `familyLayer = −1` is its own family, keyed `−1 − index`. */
  families: Map<number, Family>;
  /** The declaring families and their attachments (taken from each family's first layer, 06 §6.2). */
  declared: Array<{ family: number; attachments: StrokeAttachment[] }>;
  hooks: Map<StrokeAttachment, Hook | undefined>;
}

const cache = new WeakMap<AnimDrawing, Resolved>();

const loopsOf = (d: AnimDrawing, i: number): Loop[] => {
  const l = d.layers[i]!;
  return prepare(l.path.ops, l.path.argCounts, l.path.args, [0, l.path.ops.length], l.strokeKeyframes).loops;
};

function resolved(d: AnimDrawing): Resolved {
  let r = cache.get(d);
  if (r) return r;
  const families = new Map<number, Family>();
  const declared: Resolved["declared"] = [];
  d.layers.forEach((l, i) => {
    const key = l.familyLayer >= 0 ? l.familyLayer : -1 - i;
    let fam = families.get(key);
    if (!fam) {
      families.set(key, (fam = { layers: [], offsets: [], counts: [] }));
      if (l.attachments.length > 0) declared.push({ family: key, attachments: l.attachments });
    }
    const count = loopsOf(d, i).length;
    const last = fam.layers.length - 1;
    fam.offsets.push(last >= 0 ? fam.offsets[last]! + fam.counts[last]! : 0);
    fam.counts.push(count);
    fam.layers.push(i);
  });
  r = { families, declared, hooks: new Map() };
  cache.set(d, r);
  return r;
}

function locate(fam: Family | undefined, index: number): Site | undefined {
  if (!fam || !Number.isInteger(index) || index < 0) return undefined;
  for (let k = 0; k < fam.layers.length; k++) {
    const local = index - fam.offsets[k]!;
    if (local >= 0 && local < fam.counts[k]!) return { layer: fam.layers[k]!, local };
  }
  return undefined;
}

/** A record position `d` as a point at rest (06 §6.1: subpath `floor(d)`, arc fraction `d − floor(d)`). */
function restPoint(loops: Loop[], d: number): [number, number] | undefined {
  const loop = loops[Math.floor(d)];
  return loop ? pointAt(loop, (d - Math.floor(d)) * loop.length) : undefined;
}

/** 08 §11.2 the hook: the target subpath's record at progress `a` (ties: midpoint nearest the anchor), and its rest chord. */
function hookOf(d: AnimDrawing, site: Site, data: { a: number; anchorX: number; anchorY: number }): Hook | undefined {
  const layer = d.layers[site.layer]!;
  const loops = loopsOf(d, site.layer);
  const a = f(data.a);
  const candidates = layer.strokeKeyframes
    .map((k, id) => ({ k, id }))
    .filter(({ k }) => Math.floor(k.d0) === site.local && Math.abs(k.progress - a) < EPS);
  if (candidates.length === 0) return undefined;
  // [INF] The anchor in viewBox units, y up from the viewBox's bottom edge, into path space.
  const [vx, vy, , vh] = d.viewBox;
  const anchor = viewBoxToPath(d.transform, vx + data.anchorX, vy + vh - data.anchorY) ?? [0, 0];
  let best: Hook | undefined;
  let bestDist = Infinity;
  for (const { k, id } of candidates) {
    const p0 = restPoint(loops, k.d0);
    const p1 = restPoint(loops, k.d1);
    if (!p0 || !p1) continue;
    const dist = Math.hypot((p0[0] + p1[0]) / 2 - anchor[0], (p0[1] + p1[1]) / 2 - anchor[1]);
    if (dist >= bestDist) continue;
    bestDist = dist;
    // P0 starts the shorter forward arc: d0 first when |Δ| ≤ 0.5 and d0 ≤ d1, or |Δ| > 0.5 and d1 < d0.
    const span = Math.abs(k.d1 - k.d0);
    const d0First = (span <= 0.5 && k.d0 <= k.d1) || (span > 0.5 && k.d1 < k.d0);
    best = d0First ? { id, P0: p0, P1: p1 } : { id, P0: p1, P1: p0 };
  }
  return best;
}

/** 08 §11.3: the target run with `noRemove | noEndcaps` only to see where its caps fall. */
function capsOf(d: AnimDrawing, layer: number, lo: number, hi: number): CapRecord[] {
  const l = d.layers[layer]!;
  const p = prepare(l.path.ops, l.path.argCounts, l.path.args, [0, l.path.ops.length], l.strokeKeyframes);
  if (Math.abs(hi - lo) < EPS) {
    lo -= EPS;
    hi += EPS;
  }
  const caps: CapRecord[] = [];
  clipContours(p.contours, lo, hi, { noRemove: true, noEndcaps: true }, new PathWriter(), caps);
  return caps;
}

/** [INF] The first cap whose skipped arc (from E forward to P) holds a point of the hooked record. */
function tipOf(caps: CapRecord[], hook: Hook): CapRecord | undefined {
  for (const cap of caps) {
    const L = cap.contour.loop.length;
    const skipped = wrap(cap.entry - cap.exit, L);
    for (const r of cap.contour.recs) {
      if (r.id !== hook.id) continue;
      if ([r.s0, r.s1].some((s) => wrap(s - cap.exit, L) <= skipped + 1e-9 * Math.max(L, 1))) return cap;
    }
  }
  return undefined;
}

const z = (v: number) => (v === 0 ? 0 : v);

/** One entry per subpath: a later attachment on the same rider subpath replaces the earlier (last wins). */
function put(st: LayerState, subpath: number, transform: Matrix): void {
  st.subpathTransforms = st.subpathTransforms.filter((e) => e.subpath !== subpath);
  st.subpathTransforms.push({ subpath, transform });
}

/**
 * 08 §11: every rider's per-subpath transform for this instant, from its target's final stroke
 * range (so after every layer's range is known). Writes into `subpathTransforms` of the layer
 * holding each rider subpath, replacing any earlier entry for that subpath (idempotent): the tip-following similarity, a scale about the rest chord's
 * midpoint, or "hidden" — the subpath collapsed to its start point (`[0, 0, 0, 0, x, y]`), which
 * keeps later subpaths' numbers (08 §11.7). Reads `strokeStart`, `strokeEnd`, `strokeClip` and
 * `attachmentScale` of `states` (indexed like `d.layers`).
 */
export function resolveRiders(d: AnimDrawing, states: LayerState[]): void {
  const r = resolved(d);
  const capCache = new Map<string, CapRecord[]>();
  // Idempotent: drop any earlier entry for a rider subpath this drawing owns before writing.
  const owned = new Map<number, Set<number>>();
  for (const { family, attachments } of r.declared) {
    for (const att of attachments) {
      for (const rider of att.riders) {
        const rs = locate(r.families.get(family), rider);
        if (!rs) continue;
        let set = owned.get(rs.layer);
        if (!set) owned.set(rs.layer, (set = new Set()));
        set.add(rs.local);
      }
    }
  }
  for (const [layer, subs] of owned) {
    const st = states[layer];
    if (st) st.subpathTransforms = st.subpathTransforms.filter((e) => !subs.has(e.subpath));
  }
  for (const { family, attachments } of r.declared) {
    const declaring = r.families.get(family);
    for (const att of attachments) {
      const has = (att.flags & HAS_START_PROGRESS) !== 0;
      const both = (att.flags & (IGNORE_TRANSLATION | IGNORE_ROTATION)) === (IGNORE_TRANSLATION | IGNORE_ROTATION);
      // 08 §11.1: skipped outright.
      if (both && !has) continue;
      const data = d.drawAttachmentData[att.dataIndex];
      if (!data) continue;
      const site = locate(r.families.get(att.targetLayer), att.targetSubpath);
      if (!site) continue;
      const target = d.layers[site.layer]!;
      const ts = states[site.layer];
      if (target.strokeKeyframes.length === 0 || !ts?.strokeClip) continue;
      const lo = ts.strokeStart;
      const hi = ts.strokeEnd;
      if (!r.hooks.has(att)) r.hooks.set(att, hookOf(d, site, data));
      const hook = r.hooks.get(att);
      const a = f(data.a);
      const b = f(data.b);

      for (const rider of att.riders) {
        const rs = locate(declaring, rider);
        if (!rs) continue;
        const st = states[rs.layer];
        if (!st) continue;
        // 08 §11.6: nothing for a declaring layer drawn whole and unscaled. The model reads the
        // rider's own layer: in the catalog a rider shares its node (so its layer) with the
        // declaring family's stroke (08 §11.7), and every layer of a family has the same range role.
        if (st.strokeStart === 0 && st.strokeEnd === 1 && st.attachmentScale === 1) continue;

        // 08 §11.4 hidden.
        const span = hi - lo;
        const b2 = has ? b : 0;
        const a2 = !has ? 1 : hook ? a : b;
        let hidden = span < FULL;
        if (span >= EPS && span < FULL) hidden = lo === 0 ? hi < b2 : a2 < lo;
        if (hidden) {
          const start = loopsOf(d, rs.layer)[rs.local]!.start;
          put(st, rs.local, [0, 0, 0, 0, z(start[0]), z(start[1])]);
          continue;
        }

        // 08 §11.5 scale.
        let s = 1;
        if (!both && has) {
          if (lo === 0) {
            const X = target.strokeLength ?? 0;
            const end = Math.min(b + (X > 0 ? GROW / X : Infinity), 1);
            const den = end - b;
            const k = den > 0 ? Math.min(Math.max((hi - b) / den, 0), 1) : hi >= b ? 1 : 0;
            s = 0.5 + 0.5 * k;
          } else s = st.attachmentScale;
        }
        if (!Number.isFinite(s)) s = 1;

        // 08 §11.3, §11.6 the transform.
        let tip: CapRecord | undefined;
        if (hook) {
          const key = `${site.layer}:${lo}:${hi}`;
          let caps = capCache.get(key);
          if (!caps) capCache.set(key, (caps = capsOf(d, site.layer, lo, hi)));
          tip = tipOf(caps, hook);
        }
        let m: Matrix | undefined;
        if (tip && hook) {
          const [P0, P1] = [hook.P0, hook.P1];
          const [C0, C1] = [tip.E, tip.P];
          const th = att.flags & IGNORE_ROTATION ? 0 : Math.atan2(C1[1] - C0[1], C1[0] - C0[0]) - Math.atan2(P1[1] - P0[1], P1[0] - P0[0]);
          const c = Math.cos(th) * s;
          const n = Math.sin(th) * s;
          m = [c, n, -n, c, C0[0] - (c * P0[0] - n * P0[1]), C0[1] - (n * P0[0] + c * P0[1])];
        } else if (s !== 1 && hook) {
          const mx = (hook.P0[0] + hook.P1[0]) / 2;
          const my = (hook.P0[1] + hook.P1[1]) / 2;
          m = [s, 0, 0, s, mx - s * mx, my - s * my];
        }
        if (m) put(st, rs.local, m.map(z) as Matrix);
      }
    }
  }
}

/** Whether `d` declares any attachment (riders need resolving after sampling). */
export function hasRiders(d: AnimDrawing): boolean {
  return d.layers.some((l) => l.attachments.length > 0);
}
