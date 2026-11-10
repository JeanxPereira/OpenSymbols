import type { SymbolData, VariantData, Weight } from "./format.js";
import { interpolate, SCALE_SIZE, type Scale } from "./weight.js";
import { resolveApproximations, resolveLayer, type PaintOptions } from "./paint.js";
import { argOffsets, formatNumber, formatSignificant, serializePath } from "./path.js";

export interface SvgNode {
  tag: "svg" | "g" | "path" | "mask" | "rect" | "defs" | "title";
  attrs: Record<string, string | number>;
  children: SvgNode[];
  /** Text content (used by `title`). */
  text?: string;
}

export interface RenderOptions extends Omit<PaintOptions, "variableValueMode" | "vcContinuous"> {
  size: number;
  weight: Weight;
  layout: "box" | "text";
  direction: "ltr" | "rtl";
  idPrefix: string;
  title?: string;
  /**
   * The symbol scale (Docs/format/01 section 5.4): the weight table's size row and the glyph drawn
   * `S` = 1, 1.276, 1.647 times larger. In box layout the glyph still fits the box. Default "medium".
   */
  scale?: Scale;
  /** A BCP-47 tag choosing a localized drawing (`resolveLocale`); default the base drawing. */
  locale?: string;
}

const round3 = (n: number): number => Number(formatNumber(n));
const node = (tag: SvgNode["tag"], attrs: SvgNode["attrs"], children: SvgNode[] = [], text?: string): SvgNode =>
  text === undefined ? { tag, attrs, children } : { tag, attrs, children, text };

const subtags = (tag: string): string[] => tag.replace(/_/g, "-").toLowerCase().split("-").filter((t) => t !== "");

/**
 * The tag in `data.locales` a BCP-47 `locale` resolves to (Docs/format/05 section 4.3), compared
 * case-insensitively: the exact tag; else a shorter prefix of it (RFC 4647 lookup: `zh-Hant-TW`,
 * `zh-Hant`, then the language `zh`); else the first stored tag, in sorted order, with the same
 * language (`zh` → `zh-Hans` when `zh-Hans` and `zh-Hant` are stored). Undefined: draw the base
 * `variants`.
 */
export function resolveLocale(data: SymbolData, locale: string | undefined): string | undefined {
  if (locale === undefined || data.locales === undefined) return undefined;
  const byKey = new Map(Object.keys(data.locales).map((k) => [subtags(k).join("-"), k]));
  const want = subtags(locale);
  for (let n = want.length; n > 0; n--) {
    // A singleton (`x`, `u`) is never left at the end of a prefix.
    if (want[n - 1]!.length === 1) continue;
    const hit = byKey.get(want.slice(0, n).join("-"));
    if (hit !== undefined) return hit;
  }
  const lang = want[0];
  if (lang === undefined) return undefined;
  return Object.keys(data.locales)
    .sort()
    .find((k) => subtags(k)[0] === lang);
}

/** Docs/format/05 section 4.4 within one variant set; undefined when none of the keys is stored. */
function pickIn(
  variants: Record<string, VariantData>,
  defaultKey: string,
  appearance: "light" | "dark",
  direction: "ltr" | "rtl",
): VariantData | undefined {
  const has = (k: string) => Object.hasOwn(variants, k);
  const dirs = new Set(
    Object.keys(variants).flatMap((k) => {
      const m = /^a\d+d(\d+)$/.exec(k);
      return m ? [m[1]!] : [];
    }),
  );
  // rtl takes direction 5 whenever it is stored: a true pair (05 §4.4), or a base drawn the same
  // both ways plus its `.rtl` facet (05 §4.3). ltr takes 4 only from a true pair.
  const d = direction === "rtl" ? (dirs.has("5") ? 5 : 0) : dirs.has("4") && dirs.has("5") ? 4 : 0;
  const a = appearance === "dark" ? 1 : 0;
  for (const key of [`a${a}d${d}`, `a0d${d}`, `a${a}d0`, "a0d0", defaultKey]) {
    if (has(key)) return variants[key]!;
  }
  return undefined;
}

/**
 * Docs/format/05 section 4.4: dark uses appearance 1 when stored; rtl uses direction 5 when stored,
 * ltr uses 4 when the set holds both 4 and 5 (else direction 0). Missing keys fall back toward
 * `defaultVariant`. With a `locale` that resolves (`resolveLocale`), the same pick runs first in
 * that locale's set; a set with none of the keys falls back to the base `variants`.
 */
export function pickVariant(
  data: SymbolData,
  appearance: "light" | "dark",
  direction: "ltr" | "rtl",
  locale?: string,
): VariantData {
  const tag = resolveLocale(data, locale);
  if (tag !== undefined) {
    const v = pickIn(data.locales![tag]!, data.defaultVariant, appearance, direction);
    if (v !== undefined) return v;
  }
  return pickIn(data.variants, data.defaultVariant, appearance, direction) ?? data.variants[data.defaultVariant]!;
}

type Matrix = [number, number, number, number, number, number];

/** Bounding box, in path space, of the viewBox seen through the inverse of `m`; null if singular. */
function pathSpaceBox(vb: number[], m: Matrix): [number, number, number, number] | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  const corners: [number, number][] = [
    [vb[0]!, vb[1]!],
    [vb[0]! + vb[2]!, vb[1]!],
    [vb[0]!, vb[1]! + vb[3]!],
    [vb[0]! + vb[2]!, vb[1]! + vb[3]!],
  ];
  for (const [px, py] of corners) {
    const x = px - e;
    const y = py - f;
    xs.push((d * x - c * y) / det);
    ys.push((a * y - b * x) / det);
  }
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

export function buildSvg(
  data: SymbolData,
  opts: RenderOptions,
): { root: SvgNode; approximate: boolean; approximations: string[] } {
  const variant = pickVariant(data, opts.appearance, opts.direction, opts.locale);
  const glyphScale = opts.scale ?? "medium";
  const ip = interpolate(variant, opts.weight, glyphScale);
  // A mode the symbol does not offer (Docs/format/05 section 3.4) is drawn in monochrome.
  const modeMissing = !data.modes.includes(opts.mode);
  const paint: PaintOptions = {
    mode: modeMissing ? "monochrome" : opts.mode,
    color: opts.color,
    appearance: opts.appearance,
    variableValueMode: variant.variableValueMode,
    vcContinuous: variant.vcContinuous,
    ...(opts.palette !== undefined ? { palette: opts.palette } : {}),
    ...(opts.variableValue !== undefined ? { variableValue: opts.variableValue } : {}),
  };

  // Reasons in a stable order: weight-unavailable, mode, paint, layout, metrics, build.
  const approximations: string[] = [];
  if (ip.masterMissing) approximations.push("weight-unavailable");
  if (modeMissing) approximations.push("mode");
  approximations.push(...resolveApproximations(data, variant, paint));

  // Layout (spec section 8.1).
  let viewBox: number[];
  let width: number;
  let height: number;
  let style: string | undefined;
  if (opts.layout === "box") {
    // The square's side is the largest master's at this scale, so no weight overflows it and a
    // weight change never rescales the icon; it is centred on the weight's own viewBox. The scale
    // changes the weights and proportions, not the pixel size.
    const S = SCALE_SIZE[glyphScale];
    const [x, y, w, h] = ip.viewBox;
    let side = Math.max(w, h);
    for (const m of Object.values(variant.masters)) side = Math.max(side, S * m.viewBox[2], S * m.viewBox[3]);
    viewBox = [x + w / 2 - side / 2, y + h / 2 - side / 2, side, side];
    width = height = opts.size;
  } else {
    // The text layout's scale and baseline are inferred, not decoded.
    approximations.push("text-layout");
    viewBox = ip.viewBox;
    const metrics = ip.metrics;
    if (metrics === undefined) {
      // No TLV 1018: the box scale, the longer viewBox side to `size`, and no baseline shift.
      approximations.push("metrics");
      const scale = opts.size / Math.max(ip.viewBox[2], ip.viewBox[3]);
      width = ip.viewBox[2] * scale;
      height = ip.viewBox[3] * scale;
    } else {
      // [INF] scale = size / referencePointSize: the viewBox is in points at referencePointSize
      // (Docs/format/06 section 9.1, transform scale = referencePointSize / 2048). The symbol
      // scale S is already in the viewBox and the baseline (`interpolate`).
      const scale = opts.size / metrics.referencePointSize;
      width = ip.viewBox[2] * scale;
      height = ip.viewBox[3] * scale;
      // [INF] Docs/format/06 section 9.1: transform.f = viewBox height - baselineOffset, so the
      // baseline lies baselineOffset above the viewBox's bottom edge, and the bottom edge sits
      // that far below the text baseline: vertical-align = -baselineOffset, scaled.
      style = `vertical-align: ${formatSignificant(-metrics.baselineOffset * scale)}px`;
    }
  }
  if (data.build?.validated === false) approximations.push("build");

  // Paths live inside the transformed group, so the masks are given in path space: the viewBox
  // through the inverse transform, padded so rounding or antialiasing never clips an edge.
  const box = pathSpaceBox(viewBox, ip.transform);
  const pad = box ? Math.max(box[2], box[3]) * 0.5 + 1 : 0;
  const mb: [number, number, number, number] = box
    ? [box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad]
    : [-1e5, -1e5, 2e5, 2e5];
  const rectAttrs = { x: round3(mb[0]), y: round3(mb[1]), width: round3(mb[2]), height: round3(mb[3]) };

  const offsets = argOffsets(variant.argCounts);
  const masks: SvgNode[] = [];
  let painted: SvgNode[] = [];
  variant.layers.forEach((layer, i) => {
    const r = resolveLayer(layer, paint);
    if (!r.visible) return;
    const d = serializePath(variant.ops, variant.argCounts, ip.args, layer.cmd, offsets);
    if (r.knockout) {
      // [INF] The mask erases fully whatever the layer's opacity (an opacity-0 clear-behind layer
      // must still erase, Docs/format/06 section 4.5/5.3); whether CoreUI scales the erase by
      // opacity in hierarchical mode is not decoded.
      // destination-out over everything drawn so far (Docs/format/06 section 5.3). Nesting makes
      // each knockout erase only what precedes it.
      if (painted.length === 0) return;
      const id = `${opts.idPrefix}-k${i}`;
      masks.push(
        node("mask", { id, maskUnits: "userSpaceOnUse", ...rectAttrs }, [
          node("rect", { ...rectAttrs, fill: "#fff" }),
          // `data-layer` lets an effects driver move this copy with its layer (the layer's own
          // `<g data-layer>` is never painted).
          node("path", { d, fill: "#000", "data-layer": i }),
        ]),
      );
      painted = [node("g", { mask: `url(#${id})` }, painted)];
      return;
    }
    const attrs: SvgNode["attrs"] = { d, fill: r.fill };
    if (r.opacity < 1) attrs["fill-opacity"] = round3(r.opacity);
    // Each layer in its own group, which carries only its source index: an effects driver writes
    // the layer's transform, opacity and display there; statically it draws nothing of its own.
    painted.push(node("g", { "data-layer": i }, [node("path", attrs)]));
  });

  // 6 significant digits: the scale is about referencePointSize / 2048 (Docs/format/02 section 5.3).
  const group = node("g", { transform: `matrix(${ip.transform.map((n) => formatSignificant(n)).join(" ")})` }, painted);

  const children: SvgNode[] = [];
  if (opts.title !== undefined) children.push(node("title", {}, [], opts.title));
  if (masks.length > 0) children.push(node("defs", {}, masks));
  children.push(group);

  const attrs: SvgNode["attrs"] = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: viewBox.map((n) => formatSignificant(n)).join(" "),
    width: round3(width),
    height: round3(height),
  };
  if (style !== undefined) attrs.style = style;
  if (opts.title !== undefined) attrs.role = "img";
  else attrs["aria-hidden"] = "true";

  return { root: node("svg", attrs, children), approximate: approximations.length > 0, approximations };
}
