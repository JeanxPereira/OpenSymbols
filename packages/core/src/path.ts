/** Round to 3 decimals, `-0` becomes `0`, never exponent notation. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1e21) throw new TypeError(`number out of range for a path: ${n}`);
  let s = n.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** Below this magnitude a value is written as 0 (no attribute value needs it, and `toFixed` stops at 100 digits). */
const SIGNIFICANT_FLOOR = 1e-15;

/**
 * Round to `digits` significant digits (default 6), `-0` becomes `0`, never exponent notation.
 * For values whose size matters more than their decimals: a group transform's scale is about
 * `referencePointSize / 2048` (Docs/format/06 section 9.1), e.g. `0.00634765` on `wifi`
 * (Docs/format/02 section 5.3), which 3 decimals would cut to `0.006`.
 */
export function formatSignificant(n: number, digits = 6): string {
  if (!Number.isFinite(n) || Math.abs(n) < SIGNIFICANT_FLOOR) return "0";
  if (Math.abs(n) >= 1e21) throw new TypeError(`number out of range: ${n}`);
  const r = Number(n.toPrecision(digits));
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(r))));
  let s = r.toFixed(Math.min(decimals, 100));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/** Offset into the flat args array of each command (prefix sums of `argCounts`), plus the total. */
export function argOffsets(argCounts: number[]): number[] {
  const out = new Array<number>(argCounts.length + 1);
  let sum = 0;
  for (let i = 0; i < argCounts.length; i++) {
    out[i] = sum;
    sum += argCounts[i]!;
  }
  out[argCounts.length] = sum;
  return out;
}

/**
 * The SVG path `d` for the commands in `range` = `[start, end)` (command indices, as in
 * `LayerData.cmd`). Relative/absolute letters are kept as stored. `offsets` is
 * `argOffsets(argCounts)`; pass it to avoid recomputing it per layer.
 */
export function serializePath(
  ops: string,
  argCounts: number[],
  args: number[],
  range: [number, number],
  offsets: number[] = argOffsets(argCounts),
): string {
  let d = "";
  for (let i = range[0]; i < range[1]; i++) {
    d += ops[i]!;
    const from = offsets[i]!;
    const n = argCounts[i]!;
    for (let k = 0; k < n; k++) d += (k > 0 ? " " : "") + formatNumber(args[from + k]!);
  }
  return d;
}
