import { forwardRef, type ForwardRefExoticComponent, type Ref, type RefAttributes, type SVGProps } from "react";
import { FORMAT_VERSION, type RenderingMode, type SymbolData, type Weight } from "@opensymbols/core";
import type { EffectProps, SymbolHandle } from "./effects.js";
import { SymbolIcon } from "./symbol-icon.js";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref" | "color" | "direction"> {
  /** Edge length in px (box layout) or the text size the icon is scaled to (text layout). Default 24. */
  size?: number;
  /** Weight name or a number on the 1..9 scale. Default "regular". */
  weight?: Weight;
  /** Rendering mode. Default "monochrome". */
  mode?: RenderingMode;
  /** Tint colour. Default "currentColor". */
  color?: string;
  /** Palette colours for `palette` mode. */
  palette?: string[];
  /** 0..1 variable value. */
  variableValue?: number;
  /** Default "light". */
  appearance?: "light" | "dark";
  /** Default "box". */
  layout?: "box" | "text";
  /**
   * `auto` (default) renders LTR, then follows the closest `[dir]` ancestor after mount. A `dir`
   * change after mount is not observed: pass `direction` or remount the icon.
   */
  direction?: "ltr" | "rtl" | "auto";
  /** Accessible name. Without it the icon is decorative (`aria-hidden`). */
  title?: string;
  /*
   * Effects (spec section 9.3). Inert until `import "@opensymbols/animate/react"` has run once in
   * the app: without it they are ignored and never reach the DOM.
   */
  /** The effect `trigger`, `active` and `effectRef.play` use; `visible` plays its appear/disappear options. */
  effect?: EffectProps;
  /** Discrete: each change of this value plays `effect` once (not on mount). */
  trigger?: unknown;
  /** Indefinite: plays `effect` continuously while true; when it turns false the cycle finishes, then rests. */
  active?: boolean;
  /** Transition: false plays Disappear and keeps the icon mounted but hidden; true plays Appear. */
  visible?: boolean;
  /** Receives `{ play(effect), stop() }`. (`ref` stays the `<svg>` element.) */
  effectRef?: Ref<SymbolHandle>;
}

export type OpenSymbolIcon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>> & {
  symbolName: string;
  data: SymbolData;
};

/**
 * Builds a React component for one generated symbol: a thin wrapper over `<SymbolIcon data>`.
 */
export function createIcon(data: SymbolData): OpenSymbolIcon {
  if (data.v !== FORMAT_VERSION) {
    throw new TypeError(`Unsupported OpenSymbols data version ${String(data.v)} (expected ${FORMAT_VERSION})`);
  }

  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(props, ref) {
    return <SymbolIcon {...props} data={data} ref={ref} />;
  }) as OpenSymbolIcon;

  Icon.displayName = `Icon(${data.name})`;
  Icon.symbolName = data.name;
  Icon.data = data;
  return Icon;
}
