import type { MasterMetrics, Transform, ViewBox } from "./format.js";

/**
 * Docs/format/06 section 9.2: a point in viewBox units into path space, through the inverse of
 * `transform = (a b c d e f)`. Undefined when the transform is singular or not finite.
 */
export function viewBoxToPath(transform: Transform, X: number, Y: number): [number, number] | undefined {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return undefined;
  const x = (d * (X - e) - c * (Y - f)) / det;
  const y = (-b * (X - e) + a * (Y - f)) / det;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

/**
 * Docs/format/06 section 9.3: the metric centre in path space, from one master's viewBox,
 * transform and glyph metrics. Undefined when the transform is singular.
 */
export function metricCenter(viewBox: ViewBox, transform: Transform, metrics: MasterMetrics): [number, number] | undefined {
  const [vx, vy, w, h] = viewBox;
  const xVb = vx + (metrics.leftInset + w + metrics.rightInset) / 2 - metrics.leftInset;
  const yUp = metrics.capHeight / 2 + metrics.baselineOffset;
  const yVb = vy + h - yUp;
  return viewBoxToPath(transform, xVb, yVb);
}
