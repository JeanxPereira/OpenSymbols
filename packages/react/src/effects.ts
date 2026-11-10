import type { Ref, RefObject } from "react";
import type { RenderingMode, SymbolData, Weight } from "@opensymbols/core";

/** Options every effect takes. */
interface EffectBase {
  /** Higher is faster: 2 plays twice as fast. Finite and > 0. Default 1. */
  speed?: number;
  /** Stagger by motion group (layer by layer) rather than move the symbol as one. Default true. */
  byLayer?: boolean;
}

/** An effect that has a continuous form. `active` and `play` choose it themselves; `repeat` is for `play`. */
interface Repeating {
  /** For `play()`: run once (default) or until `stop()`. `active` always runs continuously. */
  repeat?: "once" | "continuous";
}

/**
 * The effect an icon plays, a discriminated union on `kind`: each kind takes only its own options
 * (Docs/format/07). The names mirror the engine's `Spec`.
 */
export type EffectProps =
  | (EffectBase & { kind: "appear" | "disappear"; direction?: "up" | "down" })
  | (EffectBase & Repeating & { kind: "bounce"; direction?: "up" | "down" })
  | (EffectBase & Repeating & { kind: "pulse" })
  | (EffectBase & Repeating & { kind: "breathe"; /** No pulse in opacity, only the scale. */ breathePlain?: boolean })
  | (EffectBase & Repeating & { kind: "wiggle" })
  | (EffectBase &
      Repeating & {
        kind: "rotate";
        /** Default: the symbol's own direction. */
        rotateDirection?: "clockwise" | "counterClockwise";
      })
  | (EffectBase & { kind: "scale"; direction?: "up" | "down" })
  | (EffectBase & {
      kind: "draw";
      /** Draw Off instead of Draw On. */
      reversed?: boolean;
      /** Each layer drawn in turn rather than the motion groups together. */
      drawIndividually?: boolean;
      /** Draw Off only: retract the stroke and take the groups in reverse order. */
      drawReversedOrder?: boolean;
    })
  | { kind: "variableColor"; /** 0..1. */ variableValue?: number };

/** The effect kinds an icon takes (Replace is its own component). */
export type EffectKindProp = EffectProps["kind"];

/** The imperative handle passed through `effectRef` once the effects are registered. */
export interface SymbolHandle {
  /** Plays `effect` now, replacing whatever runs; `repeat: "continuous"` runs until `stop()`. */
  play(effect: EffectProps): void;
  /** Stops a continuous effect: it finishes its current cycle, then settles at rest. */
  stop(): void;
}

/** What `SymbolIcon` hands the registered effects hook on every render. */
export interface EffectsInput {
  /** The rendered `<svg>` (null before mount). */
  svg: RefObject<SVGSVGElement | null>;
  data: SymbolData;
  weight: Weight;
  /** The rendering mode actually drawn (a mode the symbol lacks is drawn in monochrome). */
  mode: RenderingMode;
  appearance: "light" | "dark";
  /** The resolved direction. */
  direction: "ltr" | "rtl";
  effect: EffectProps | undefined;
  trigger: unknown;
  /** Whether the `trigger` prop was passed at all (`undefined` is a value it can change from). */
  hasTrigger: boolean;
  active: boolean | undefined;
  visible: boolean | undefined;
  effectRef: Ref<SymbolHandle> | undefined;
}

/** The effects implementation `@opensymbols/animate/react` registers. */
export interface EffectsImpl {
  /** A React hook, called once per render of every icon mounted after registration. Returns extra `<svg>` props. */
  useSymbolEffects(input: EffectsInput): Record<string, unknown> | undefined;
}

let registered: EffectsImpl | undefined;

/**
 * Installs the effects implementation. `import "@opensymbols/animate/react"` calls it; until then the
 * effect props are ignored, so a static-only app never bundles the engine. An icon reads the
 * registration when it mounts: icons mounted earlier stay static.
 */
export function registerEffects(impl: EffectsImpl): void {
  registered = impl;
}

/** Internal: the registered implementation, if any. */
export function effectsImpl(): EffectsImpl | undefined {
  return registered;
}
