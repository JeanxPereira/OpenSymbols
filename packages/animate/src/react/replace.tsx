import { useEffect, useRef, useState, type ReactElement } from "react";
import type { IconProps, OpenSymbolIcon } from "@opensymbols/react";
import { replaceDuration, replacePairIn } from "../replace-pair.js";
import { defaultSpec, type Spec } from "../spec.js";
import { cancel, now, reducedMotion, reset, start, type Run, type Target } from "./driver.js";
import { drawingOf } from "./use-effect.js";

export interface ReplaceProps extends Omit<IconProps, "effect" | "trigger" | "active" | "visible" | "effectRef" | "style" | "from" | "to"> {
  /** The two symbols. Both are rendered, stacked; the one not shown is hidden. */
  from: OpenSymbolIcon;
  to: OpenSymbolIcon;
  /** Which one is shown. A change plays the Replace from the shown one to the other. */
  show: "from" | "to";
  /** Replace style (07 §7.9). Default "downUp". */
  style?: Spec["replaceStyle"];
  /** Magic Replace (07 §7.10): a slash or badge difference animates in place, else the plain Replace. */
  magic?: boolean;
  /** Higher is faster. Default 1. */
  speed?: number;
  /** Default true. */
  byLayer?: boolean;
  /** Class of the wrapping `<span>` (the icon props go to both icons). */
  wrapperClassName?: string;
}

const STACK = { gridArea: "1 / 1" } as const;

/**
 * Swaps between two symbols with the Replace effect (spec §9.3). Both icons stay mounted, stacked
 * in an inline grid; a change of `show` drives `replacePair` on the shared loop: the source's layers
 * get the out half, the destination's the in half, each in the mode its icon is drawn in. Under
 * reduced motion the swap is immediate.
 */
export function Replace(props: ReplaceProps): ReactElement {
  const { from: From, to: To, show, style = "downUp", magic = false, speed, byLayer, wrapperClassName, ...icon } = props;
  const fromRef = useRef<SVGSVGElement>(null);
  const toRef = useRef<SVGSVGElement>(null);
  const [shown, setShown] = useState({ from: show === "from", to: show === "to" });
  const last = useRef(show);
  const run = useRef<Run | undefined>(undefined);

  useEffect(
    () => () => {
      cancel(run.current);
      run.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (last.current === show) return;
    last.current = show;
    const settled = { from: show === "from", to: show === "to" };
    const [outEl, inEl, OutIcon, InIcon] = show === "to" ? [fromRef.current, toRef.current, From, To] : [toRef.current, fromRef.current, To, From];
    if (run.current) {
      cancel(run.current);
      for (const t of run.current.targets) reset(t);
      run.current = undefined;
    }
    if (!outEl || !inEl || reducedMotion()) {
      setShown(settled);
      return;
    }
    const direction = (el: SVGSVGElement): "ltr" | "rtl" =>
      icon.direction === "ltr" || icon.direction === "rtl" ? icon.direction : el.closest("[dir]")?.getAttribute("dir") === "rtl" ? "rtl" : "ltr";
    const common = { weight: icon.weight ?? "regular", appearance: icon.appearance ?? "light" } as const;
    const outD = drawingOf({ data: OutIcon.data, ...common, direction: direction(outEl) });
    const inD = drawingOf({ data: InIcon.data, ...common, direction: direction(inEl) });
    // Each icon is drawn in the requested mode, or monochrome when it lacks it (as `<SymbolIcon>`).
    const mode = icon.mode ?? "monochrome";
    const drawnIn = (data: typeof OutIcon.data) => (data.modes.includes(mode) ? mode : "monochrome");
    const inMode = drawnIn(InIcon.data);
    const spec: Spec = {
      ...defaultSpec(magic ? "magicReplace" : "replace"),
      replaceStyle: style,
      renderingMode: drawnIn(OutIcon.data),
      appearance: common.appearance,
      ...(speed !== undefined ? { speed } : {}),
      ...(byLayer !== undefined ? { byLayer } : {}),
    };
    const targets: Target[] = [
      { svg: outEl, drawing: outD },
      { svg: inEl, drawing: inD },
    ];
    const r: Run = {
      targets,
      sample: (t) => {
        const p = replacePairIn(outD, inD, spec, inMode, t);
        return [p.out, p.in];
      },
      end: replaceDuration(outD, inD, spec),
      t0: now(),
      onEnd: () => {
        // Hide the source before its layers return to their static markup, in this same frame:
        // waiting for React to commit `visibility` would show it whole for one frame. React's
        // next commit writes the same values.
        outEl.style.visibility = "hidden";
        outEl.setAttribute("aria-hidden", "true");
        for (const t of targets) reset(t);
        run.current = undefined;
        setShown(settled);
      },
    };
    run.current = r;
    setShown({ from: true, to: true });
    start(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const hide = (on: boolean) => (on ? STACK : { ...STACK, visibility: "hidden" as const });
  return (
    <span className={wrapperClassName} style={{ display: "inline-grid" }} data-replace={show}>
      <From {...icon} ref={fromRef} style={hide(shown.from)} {...(shown.from ? {} : { "aria-hidden": true })} />
      <To {...icon} ref={toRef} style={hide(shown.to)} {...(shown.to ? {} : { "aria-hidden": true })} />
    </span>
  );
}
