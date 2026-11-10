import type { LayerData, RenderMode, Role, SymbolData, VariantData } from "./format.js";

/** The brief's name for `RenderMode`; one definition, in format.ts. */
export type RenderingMode = RenderMode;

export interface PaintOptions {
  mode: RenderingMode;
  /** The tint, as CSS. */
  color: string;
  palette?: string[];
  appearance: "light" | "dark";
  variableValue?: number;
  variableValueMode: "color" | "draw";
  vcContinuous: boolean;
}

export interface ResolvedLayer {
  fill: string;
  opacity: number;
  /** The layer clears what is behind it; the SVG builder decides how to paint that. */
  knockout: boolean;
  visible: boolean;
}

/**
 * Hierarchy levels per role (Docs/format/05 section 3.5, "The hierarchy levels"):
 * primary 100 %, secondary 50 %, tertiary 18 % in light and 25 % in dark.
 */
const ROLE_LEVEL: Record<Role, { light: number; dark: number }> = {
  primary: { light: 1, dark: 1 },
  secondary: { light: 0.5, dark: 0.5 },
  tertiary: { light: 0.18, dark: 0.25 },
};

const ROLE_INDEX: Record<Role, number> = { primary: 0, secondary: 1, tertiary: 2 };

/**
 * The alpha of an inactive variable-colour layer: the target of `variable-alpha-fade`, float32
 * `0.30000001192092896` (0 only with option bit 29, which the static form does not offer).
 * Docs/format/07 section 2.3 property 10, section 9.2.
 */
export const INACTIVE_ALPHA = Math.fround(0.3);

/** [INF] Half-width of the continuous variable-colour ramp around a layer's threshold; not decoded. */
export const CONTINUOUS_BAND = 0.06;

const roleLevel = (role: Role, appearance: "light" | "dark"): number => ROLE_LEVEL[role][appearance];

/** A finite variable value clamped to [0, 1]; NaN/Infinity count as "no value applied". */
function normalizeValue(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.min(1, Math.max(0, v));
}

/** Opacity factor from the variable value for a layer with a threshold (color mode only). */
function variableFactor(layer: LayerData, opts: PaintOptions): number {
  const t = layer.variableThreshold;
  const v = normalizeValue(opts.variableValue);
  if (t === undefined || v === undefined || opts.variableValueMode !== "color") return 1;
  if (!opts.vcContinuous) return v >= t ? 1 : INACTIVE_ALPHA;
  const k = Math.min(1, Math.max(0, (v - (t - CONTINUOUS_BAND)) / (2 * CONTINUOUS_BAND)));
  return INACTIVE_ALPHA + (1 - INACTIVE_ALPHA) * k;
}

const HEX_ALPHA = /^#(?:([0-9a-fA-F]{6})([0-9a-fA-F]{2})|([0-9a-fA-F]{3})([0-9a-fA-F]))$/;

/**
 * `#rrggbbaa` / `#rgba` are not portable SVG paint (older renderers ignore the alpha), so split them
 * into an opaque `#rrggbb` and an alpha factor. Anything else passes through untouched.
 */
function splitAlpha(color: string): { fill: string; alpha: number } {
  const m = HEX_ALPHA.exec(color);
  if (!m) return { fill: color, alpha: 1 };
  if (m[1] !== undefined) return { fill: `#${m[1]}`, alpha: parseInt(m[2]!, 16) / 255 };
  const rgb = m[3]!.split("").map((c) => c + c).join("");
  return { fill: `#${rgb}`, alpha: parseInt(m[4]! + m[4]!, 16) / 255 };
}

export function resolveLayer(layer: LayerData, opts: PaintOptions): ResolvedLayer {
  const style = layer.modes[opts.mode];
  let fill = opts.color;
  let level = 1;

  switch (opts.mode) {
    case "monochrome":
      break;
    case "hierarchical":
      // The style's own role paint wins (as in multicolor); layer.role is the fallback.
      level = roleLevel(style.paint.kind === "role" ? style.paint.role : layer.role, opts.appearance);
      break;
    case "palette": {
      // As in hierarchical: the style's own role paint wins; layer.role is the fallback.
      const role = style.paint.kind === "role" ? style.paint.role : layer.role;
      const p = opts.palette;
      if (p && p.length > 0) fill = p[Math.min(ROLE_INDEX[role], p.length - 1)]!;
      break;
    }
    case "multicolor": {
      const paint = style.paint;
      if (paint.kind === "named") fill = opts.appearance === "dark" ? paint.dark : paint.light;
      else if (paint.kind === "fixed") fill = paint.hex;
      else if (paint.kind === "role") level = roleLevel(paint.role, opts.appearance);
      break;
    }
  }

  const split = splitAlpha(fill);
  const opacity = style.opacity * level * variableFactor(layer, opts) * split.alpha;
  const knockout = style.clearBehind;
  return { fill: split.fill, opacity, knockout, visible: opacity !== 0 || knockout };
}

/** Why a render is not exact, in a stable order: palette, variable-value, variable-draw. */
export function resolveApproximations(data: SymbolData, variant: VariantData, opts: PaintOptions): string[] {
  const out: string[] = [];
  if (data.palette === "stand-in" && opts.mode === "multicolor") out.push("palette");
  if (normalizeValue(opts.variableValue) !== undefined) {
    if (variant.variableValueMode === "draw") out.push("variable-draw");
    else if (variant.layers.some((l) => l.variableThreshold !== undefined)) out.push("variable-value");
  }
  return out;
}
