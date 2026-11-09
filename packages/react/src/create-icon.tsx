import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";
import { FORMAT_VERSION, buildSvg, type RenderingMode, type SymbolData, type Weight } from "@opensymbols/core";
import { toChildren, toReact } from "./to-react.js";

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
}

export type OpenSymbolIcon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>> & {
  symbolName: string;
  data: SymbolData;
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const sanitizeId = (id: string): string => `os-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

/**
 * Builds a React component for one generated symbol.
 *
 * Extra SVG props (`className`, `style`, `aria-*`, event handlers) go to the `<svg>` and override
 * generated ones. `width`, `height` and `viewBox` come from the model: `size` controls the
 * dimensions and a `width`/`height` prop is ignored.
 */
export function createIcon(data: SymbolData): OpenSymbolIcon {
  if (data.v !== FORMAT_VERSION) {
    throw new TypeError(`Unsupported OpenSymbols data version ${String(data.v)} (expected ${FORMAT_VERSION})`);
  }

  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(props, forwardedRef) {
    const {
      size = 24,
      weight = "regular",
      mode = "monochrome",
      color = "currentColor",
      palette,
      variableValue,
      appearance = "light",
      layout = "box",
      direction = "auto",
      title,
      ...rest
    } = props;
    // `width`/`height`/`viewBox` belong to the model.
    const { width: _w, height: _h, viewBox: _v, ...passthrough } = rest as Record<string, unknown>;

    const idPrefix = sanitizeId(useId());
    const innerRef = useRef<SVGSVGElement | null>(null);
    const [detected, setDetected] = useState<"ltr" | "rtl">("ltr");

    const setRef = useCallback(
      (el: SVGSVGElement | null) => {
        innerRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [forwardedRef],
    );

    useIsomorphicLayoutEffect(() => {
      if (direction !== "auto") return;
      const dir = innerRef.current?.closest("[dir]")?.getAttribute("dir");
      setDetected(dir === "rtl" ? "rtl" : "ltr");
    }, [direction]);

    const resolved = direction === "auto" ? detected : direction;

    const built = useMemo(
      () =>
        buildSvg(data, {
          mode,
          color,
          appearance,
          size,
          weight,
          layout,
          direction: resolved,
          idPrefix,
          ...(palette !== undefined ? { palette } : {}),
          ...(variableValue !== undefined ? { variableValue } : {}),
          ...(title !== undefined ? { title } : {}),
        }),
      // `palette` is compared by content so an inline array does not rebuild every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [mode, color, appearance, size, weight, layout, resolved, idPrefix, palette?.join("|"), variableValue, title],
    );

    const children = useMemo(() => toChildren(built.root), [built]);
    const extra: Record<string, unknown> = { ...passthrough, ref: setRef };
    if (built.approximate) {
      extra["data-approximate"] = "true";
      extra["data-approximations"] = built.approximations.join(" ");
    }
    return toReact(built.root, extra, undefined, children);
  }) as OpenSymbolIcon;

  Icon.displayName = `Icon(${data.name})`;
  Icon.symbolName = data.name;
  Icon.data = data;
  return Icon;
}
