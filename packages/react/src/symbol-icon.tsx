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
} from "react";
import { FORMAT_VERSION, buildSvg, type SymbolData } from "@opensymbols/core";
import type { IconProps } from "./create-icon.js";
import { effectsImpl } from "./effects.js";
import { toChildren, toReact } from "./to-react.js";

export type SymbolIconProps = IconProps & { data: SymbolData };

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const sanitizeId = (id: string): string => `os-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

/**
 * Renders one symbol from its data. Extra SVG props (`className`, `style`, `aria-*`, event handlers)
 * go to the `<svg>` and override generated ones. `width`, `height` and `viewBox` come from the model.
 * Throws a TypeError at render when the data has an unsupported format version.
 */
export const SymbolIcon: ForwardRefExoticComponent<SymbolIconProps & RefAttributes<SVGSVGElement>> = forwardRef<
  SVGSVGElement,
  SymbolIconProps
>(function SymbolIcon(props, forwardedRef) {
  const {
    data,
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
    effect,
    trigger,
    active,
    visible,
    effectRef,
    ...rest
  } = props;
  if (data.v !== FORMAT_VERSION) {
    throw new TypeError(`Unsupported OpenSymbols data version ${String(data.v)} (expected ${FORMAT_VERSION})`);
  }
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

  // Read once per instance, so the hook count never changes under an icon.
  const [effects] = useState(effectsImpl);
  const effectProps = effects?.useSymbolEffects({
    svg: innerRef,
    data,
    weight,
    mode: data.modes.includes(mode) ? mode : "monochrome",
    appearance,
    direction: resolved,
    effect,
    trigger,
    hasTrigger: Object.hasOwn(props, "trigger"),
    active,
    visible,
    effectRef,
  });

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
    [data, mode, color, appearance, size, weight, layout, resolved, idPrefix, palette?.join("|"), variableValue, title],
  );

  const children = useMemo(() => toChildren(built.root), [built]);
  const extra: Record<string, unknown> = { ...passthrough, ref: setRef };
  if (effectProps) {
    for (const [k, v] of Object.entries(effectProps)) {
      extra[k] = k === "style" && typeof extra.style === "object" && typeof v === "object" ? { ...(extra.style as object), ...(v as object) } : v;
    }
  }
  if (built.approximate) {
    extra["data-approximate"] = "true";
    extra["data-approximations"] = built.approximations.join(" ");
  }
  return toReact(built.root, extra, undefined, children);
});

SymbolIcon.displayName = "SymbolIcon";
