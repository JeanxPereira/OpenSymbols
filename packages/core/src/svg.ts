import type { SymbolData, VariantData, Weight } from "./format.js";
import { interpolate } from "./weight.js";
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
}

const round3 = (n: number): number => Number(formatNumber(n));
const node = (tag: SvgNode["tag"], attrs: SvgNode["attrs"], children: SvgNode[] = [], text?: string): SvgNode =>
  text === undefined ? { tag, attrs, children } : { tag, attrs, children, text };

/**
 * Docs/format/05 section 4.4: dark uses appearance 1 when stored; when the variant set holds both 4 and 5, ltr uses 4 and rtl uses 5 (else direction 0). Missing keys fall back toward `defaultVariant`.
 */
export function pickVariant(data: SymbolData, appearance: "light" | "dark", direction: "ltr" | "rtl"): VariantData {
  const has = (k: string) => Object.hasOwn(data.variants, k);
  const dirs = new Set(
    Object.keys(data.variants).flatMap((k) => {
      const m = /^a\d+d(\d+)$/.exec(k);
      return m ? [m[1]!] : [];
    }),
  );
  const hasPair = dirs.has("4") && dirs.has("5");
  const d = hasPair ? (direction === "rtl" ? 5 : 4) : 0;
  const a = appearance === "dark" ? 1 : 0;
  for (const key of [`a${a}d${d}`, `a0d${d}`, `a${a}d0`, "a0d0", data.defaultVariant]) {
    if (has(key)) return data.variants[key]!;
  }
  return data.variants[data.defaultVariant]!;
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
  const variant = pickVariant(data, opts.appearance, opts.direction);
  const ip = interpolate(variant, opts.weight);
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

  // Reasons in a stable order: weight, mode, paint, layout, metrics, build.
  const approximations: string[] = [];
  if (ip.masterMissing) approximations.push("weight-unavailable");
  else if (ip.approximate) approximations.push("weight");
  if (modeMissing) approximations.push("mode");
  approximations.push(...resolveApproximations(data, variant, paint));

  // Layout (spec section 8.1).
  let viewBox: number[];
  let width: number;
  let height: number;
  let style: string | undefined;
  if (opts.layout === "box") {
    // The square's side is the largest master's, so no weight overflows it and a weight change
    // never rescales the icon; it is centred on the weight's own viewBox.
    let side = 0;
    for (const m of Object.values(variant.masters)) side = Math.max(side, m.viewBox[2], m.viewBox[3]);
    const [x, y, w, h] = ip.viewBox;
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
      // (Docs/format/06 section 9.1, transform scale = referencePointSize / 2048).
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
          node("path", { d, fill: "#000" }),
        ]),
      );
      painted = [node("g", { mask: `url(#${id})` }, painted)];
      return;
    }
    const attrs: SvgNode["attrs"] = { d, fill: r.fill };
    if (r.opacity < 1) attrs["fill-opacity"] = round3(r.opacity);
    painted.push(node("path", attrs));
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
