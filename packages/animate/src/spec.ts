import type { RenderingMode } from "@opensymbols/core";

/** The effects (Docs/format/07 §7, §9; 07 §8.3 `kind`). */
export type EffectKind =
  | "appear"
  | "disappear"
  | "bounce"
  | "breathe"
  | "draw"
  | "pulse"
  | "rotate"
  | "scale"
  | "replace"
  | "magicReplace"
  | "wiggle"
  | "variableColor";

/** What a caller asks for (07 §8.3: each field and the option bits it stands for). */
export interface Spec {
  kind: EffectKind;
  /** Option bit 4 for Bounce, Wiggle, Rotate; Pulse and Breathe repeat their cycle (07 §6). */
  repeat: "once" | "continuous";
  /** Higher is faster: the plan runs at effect time `t · speed` (07 §6.4). Finite, > 0. */
  speed: number;
  /** Option bit 3: stagger by motion group (else one group, 07 §4.1). */
  byLayer: boolean;
  /** Draw: Off instead of On; Scale: down when `direction` is default (07 §8.3). */
  reversed: boolean;
  /**
   * Static Variable Color's value in [0, 1] (07 §9.2, §9.3). Present: the static form. Absent: the
   * animated form, shaped by `vcFill`, `vcReversing` and `vcInactive` (07 §9.5).
   */
  variableValue?: number;
  /** Animated Variable Color: option bit 31, iterative (07 §9.5); RenderBox's default is cumulative. */
  vcFill: "cumulative" | "iterative";
  /** Animated Variable Color: option bit 30, the reversing (bounce) builders (07 §9.5). */
  vcReversing: boolean;
  /** Animated Variable Color: option bit 29, inactive layers hidden (alpha 0) rather than dimmed (07 §9.5). */
  vcInactive: "dim" | "hide";
  direction: "default" | "up" | "down";
  /** Breathe option bit 31: no pulse-alpha (07 §7.3). */
  breathePlain: boolean;
  /** Replace option bits 30–31 (07 §7.9); downUp is the public default. */
  replaceStyle: "plain" | "downUp" | "upUp" | "offUp";
  /** Which drawing of a Replace pair this one is: the source (out) or the destination (in). */
  replaceHalf: "out" | "in";
  /**
   * Rotate's explicit direction: "default" takes the document's `rotatesClockwise` (07 §7.5);
   * "clockwise" / "counterClockwise" override its sign [INF] (the public option; Apple's mapping not read).
   */
  rotateDirection: "default" | "clockwise" | "counterClockwise";
  /** Draw `.individually`: option bit 31 with bit 3 (07 §7.8). */
  drawIndividually: boolean;
  /** Draw Off option bit 30: retract, and flip the group order (07 §7.8). */
  drawReversedOrder: boolean;
  /** The glyph's rendering mode: the eraser flag and Pulse's hierarchical floor read it (07 §2.2, §7.2). */
  renderingMode: RenderingMode;
  /** The hierarchy level opacities differ by appearance (tertiary 0.18 light, 0.25 dark; 07 §2.7, §7.2). */
  appearance: "light" | "dark";
}

/**
 * The 07 §8.3 defaults: by layer, direction default (= up), Replace downUp, once at speed 1, light;
 * Variable Color with no option bit set (cumulative, non-reversing, dim; 07 §9.5).
 */
export function defaultSpec(kind: EffectKind): Spec {
  return {
    kind,
    repeat: "once",
    speed: 1,
    byLayer: true,
    reversed: false,
    direction: "default",
    breathePlain: false,
    replaceStyle: "downUp",
    replaceHalf: "out",
    rotateDirection: "default",
    drawIndividually: false,
    drawReversedOrder: false,
    vcFill: "cumulative",
    vcReversing: false,
    vcInactive: "dim",
    renderingMode: "monochrome",
    appearance: "light",
  };
}

/** An SVG matrix `[a b c d e f]`. */
export type Matrix = [number, number, number, number, number, number];

/** One layer's animated state at an instant. */
export interface LayerState {
  /**
   * The extra transform in PATH space, applied to the layer's path before the document's
   * `transform` (identity `[1, 0, 0, 1, 0, 0]`). Composition (07 §2.5), from the point outward:
   * badge scale about the badge centre → layer rotation about the rotation anchor → scale about
   * the metric centre → symbol rotation about the metric centre → (document transform) →
   * translation, which Apple adds in output space and this matrix carries mapped back through the
   * inverse of the document transform's linear part (07 §2.6).
   */
  transform: Matrix;
  /** The product of the alpha-like properties, clamped (07 §2.7). Multiplies the painted opacity. */
  alpha: number;
  /** False when a clip-alpha is ≤ 0 or `alpha` is 0 (07 §2.7). */
  visible: boolean;
  /** The drawn stroke range on a strokable layer (08), meaningful when `strokeClip`. */
  strokeStart: number;
  strokeEnd: number;
  /** The layer's outline is cut to `[strokeStart, strokeEnd]` (a stroke track reached a strokable layer). */
  strokeClip: boolean;
  /** The rider scale (07 §2.3 property 16, 08 §11.5); 1 at rest. */
  attachmentScale: number;
  /** Per-subpath transforms of riders (08 §11.6), path space; filled by Draw. */
  subpathTransforms: Array<{ subpath: number; transform: Matrix }>;
}
