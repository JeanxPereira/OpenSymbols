import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { interpolate, pickVariant, type RenderingMode, type SymbolData, type Weight } from "@opensymbols/core";
import type { EffectProps, EffectsInput, SymbolHandle } from "@opensymbols/react";
import { toAnimDrawing, type AnimDrawing } from "../drawing.js";
import { cycleEnds, duration, sample, sampleStopped, stopAt } from "../sample.js";
import { defaultSpec, type Spec } from "../spec.js";
import { cancel, finish, invalidate, isLive, now, reducedMotion, reset, REST, start, write, type Run, type Target } from "./driver.js";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * What a drawing depends on.
 * @internal Exported for the demo's timeline; not part of the public API.
 */
export interface DrawingKey {
  data: SymbolData;
  weight: Weight;
  appearance: "light" | "dark";
  direction: "ltr" | "rtl";
}

/**
 * The engine's drawing of `data` at a weight: core's `pickVariant` + `interpolate`, as `buildSvg` draws it.
 * @internal Exported for the demo's timeline; not part of the public API.
 */
export function drawingOf({ data, weight, appearance, direction }: DrawingKey): AnimDrawing {
  const variant = pickVariant(data, appearance, direction);
  return toAnimDrawing(variant, interpolate(variant, weight), data.name);
}

/**
 * The engine's `Spec` for the public effect props.
 * @internal Exported for the demo's timeline; not part of the public API.
 */
export function toSpec(e: EffectProps, ctx: { mode: RenderingMode; appearance: "light" | "dark" }, repeat: "once" | "continuous"): Spec {
  const s = defaultSpec(e.kind);
  s.repeat = repeat;
  s.renderingMode = ctx.mode;
  s.appearance = ctx.appearance;
  if ("speed" in e && e.speed !== undefined) s.speed = e.speed;
  if ("byLayer" in e && e.byLayer !== undefined) s.byLayer = e.byLayer;
  switch (e.kind) {
    case "appear":
    case "disappear":
    case "bounce":
    case "scale":
      if (e.direction !== undefined) s.direction = e.direction;
      break;
    case "breathe":
      s.breathePlain = e.breathePlain === true;
      break;
    case "rotate":
      if (e.rotateDirection !== undefined) s.rotateDirection = e.rotateDirection;
      break;
    case "draw":
      s.reversed = e.reversed === true;
      s.drawIndividually = e.drawIndividually === true;
      s.drawReversedOrder = e.drawReversedOrder === true;
      break;
    case "variableColor":
      if (e.variableValue !== undefined) s.variableValue = e.variableValue;
      break;
  }
  return s;
}

const repeatOf = (e: EffectProps): "once" | "continuous" => ("repeat" in e && e.repeat === "continuous" ? "continuous" : "once");

/**
 * One icon's effects: at most one run on the shared loop at a time. Holds no React state of its
 * own; `onHidden` reports the Disappear/Appear boundaries (one update per transition, never per frame).
 */
export class Controller {
  input: EffectsInput | undefined;
  /** The latest run: live on the loop, or finished with its final state still on the DOM. */
  private run: Run | undefined;
  private spec: Spec | undefined;
  private drawing: { key: DrawingKey; d: AnimDrawing } | undefined;
  /** A continuous run being stopped: its `end` is the cycle end, fixed at `stop()`. */
  private stopping = false;
  /** A Disappear is running: whatever ends or replaces it, the icon ends hidden. */
  private hiding = false;
  /** `dispose` ran and nothing played since (StrictMode's simulated unmount). */
  disposed = false;

  constructor(
    private readonly svg: RefObject<SVGSVGElement | null>,
    private readonly onHidden: (hidden: boolean) => void,
  ) {}

  private currentDrawing(): AnimDrawing | undefined {
    const i = this.input;
    if (!i) return undefined;
    const c = this.drawing;
    if (c && c.key.data === i.data && c.key.weight === i.weight && c.key.appearance === i.appearance && c.key.direction === i.direction) return c.d;
    const key: DrawingKey = { data: i.data, weight: i.weight, appearance: i.appearance, direction: i.direction };
    const d = drawingOf(key);
    this.drawing = { key, d };
    return d;
  }

  /** Ends a running Disappear at once: its final state, then hidden. */
  private completeHide(): void {
    if (!this.hiding) return;
    this.hiding = false;
    const run = this.run;
    if (run && isLive(run)) {
      run.onEnd = undefined;
      finish(run);
    }
    this.onHidden(true);
  }

  /**
   * Plays `effect` from its start, replacing the running one. While `visible` is false only the
   * transitions play: any other effect first completes a running Disappear (so the icon ends
   * hidden) and is then dropped.
   */
  play(effect: EffectProps, repeat: "once" | "continuous", onEnd?: () => void): void {
    const svg = this.svg.current;
    const d = this.currentDrawing();
    const input = this.input;
    if (!svg || !d || !input) return;
    const transition = effect.kind === "appear" || effect.kind === "disappear";
    if (input.visible === false && !transition) {
      this.completeHide();
      return;
    }
    const spec = toSpec(effect, input, repeat);
    // Validates the spec (a bad speed throws here, in the caller's effect, not in the loop).
    const once = duration(d, spec);
    const loops = repeat === "continuous" && cycleEnds(d, spec, 0) !== undefined;
    if (!(transition && effect.kind === "disappear")) this.completeHide();
    cancel(this.run);
    this.disposed = false;
    this.spec = spec;
    this.stopping = false;
    const target: Target = { svg, drawing: d };
    // Reads `target.drawing` each frame, so `sync` can swap in a new weight's geometry mid-run.
    const run: Run = { targets: [target], sample: (t) => [sample(target.drawing, spec, t)], end: loops ? Infinity : once, t0: now() };
    run.onEnd = () => {
      onEnd?.();
      // A discrete effect played over `active` hands back to the continuous one.
      if (repeat === "once") this.resume();
    };
    this.run = run;
    if (reducedMotion()) {
      // Jump to the end: a once effect's last frame; a continuous loop rests.
      if (loops) {
        reset(target);
        this.run = undefined;
      } else write([target], run.sample(run.end), true);
      run.onEnd();
      return;
    }
    start(run);
  }

  private resume(): void {
    const i = this.input;
    if (i?.active && i.effect && i.visible !== false && this.svg.current?.isConnected) this.play(i.effect, "continuous");
  }

  /**
   * 07 §6.3 stop [INF]: a looping effect finishes each group's current cycle on its own delayed
   * clock, then that group plays the effect's outro (Bounce's `B → 1`, 07 §7.1; [INF] when Apple
   * starts it is not read, the model starts it at the cycle end) and rests. The other loops end
   * each cycle at rest. A finite effect runs out as it is.
   */
  stop(): void {
    const run = this.run;
    const spec = this.spec;
    if (!run || !spec || run.end !== Infinity || !isLive(run)) return;
    const target = run.targets[0]!;
    const t = Math.max(0, (now() - run.t0) / 1000);
    const halt = stopAt(target.drawing, spec, t);
    run.sample = halt ? (tt) => [sampleStopped(target.drawing, spec, halt, tt)] : () => [target.drawing.layers.map(() => REST)];
    run.end = halt ? halt.end : t;
    this.stopping = true;
    if (reducedMotion() || run.end <= t) finish(run);
  }

  /**
   * After every render: the run follows the icon's geometry (a weight or direction change), and
   * the current frame, or a finished run's held end state (a Draw Off stays clipped), is written
   * again at once, so React's fresh static markup never shows for a frame.
   */
  sync(): void {
    const run = this.run;
    const target = run?.targets[0];
    if (!run || !target || !this.spec) return;
    invalidate(target);
    // A mode change mid-run: the running spec follows the mode the icon is drawn in.
    if (this.input && this.input.mode !== this.spec.renderingMode) this.spec.renderingMode = this.input.mode;
    if (!isLive(run) && (run.dropped || !Number.isFinite(run.end))) {
      // The loop dropped it (an error, a detached `<svg>`): it has no end state to hold, so the
      // icon returns to its static markup.
      reset(target);
      this.run = undefined;
      return;
    }
    const d = this.currentDrawing();
    if (d && d !== target.drawing) {
      target.drawing = d;
      // A once effect's length can depend on the geometry (Draw's stroke lengths, 07 §7.8).
      if (run.end !== Infinity && !this.stopping) run.end = duration(d, this.spec);
    }
    if (!target.svg.isConnected) return;
    if (isLive(run)) write(run.targets, run.sample(Math.min(Math.max(0, (now() - run.t0) / 1000), run.end)), false);
    else write(run.targets, run.sample(run.end), true);
  }

  /** Off the loop with no further write (unmount). */
  dispose(): void {
    cancel(this.run);
    this.run = undefined;
    this.hiding = false;
    this.disposed = true;
  }

  /** `visible` changed: Appear or Disappear, with the effect's options when it is one of them. */
  transition(visible: boolean, effect: EffectProps | undefined): void {
    const kind = visible ? "appear" : "disappear";
    const e: EffectProps = effect && (effect.kind === "appear" || effect.kind === "disappear") ? { ...effect, kind } : { kind };
    if (visible) {
      this.hiding = false;
      this.onHidden(false);
      this.play(e, "once");
    } else {
      this.play(e, "once", () => {
        this.hiding = false;
        this.onHidden(true);
      });
      // Set after `play` (which completes any earlier hide): this Disappear is now the one running.
      this.hiding = this.run !== undefined && isLive(this.run);
      if (!this.hiding && !this.run) this.onHidden(true);
    }
  }
}

/**
 * The registered hook (spec §9.3): `trigger` changes play the effect once, `active` runs it
 * continuously and stops it gracefully, `visible` plays Appear/Disappear and keeps the icon mounted
 * but hidden, `effectRef` gets `{ play, stop }`. Every frame is written straight to the DOM by the
 * shared driver; React state changes only when the icon is hidden or shown.
 */
export function useSymbolEffects(input: EffectsInput): Record<string, unknown> | undefined {
  const [hidden, setHidden] = useState(input.visible === false);
  const ctl = useRef<Controller | null>(null);
  ctl.current ??= new Controller(input.svg, setHidden);
  const c = ctl.current;

  useIsomorphicLayoutEffect(() => {
    c.input = input;
    c.sync();
  });
  useEffect(() => () => c.dispose(), [c]);

  // Discrete: each change of `trigger` (never the mount; StrictMode's re-run compares equal).
  const lastTrigger = useRef(input.trigger);
  useEffect(() => {
    if (Object.is(lastTrigger.current, input.trigger)) return;
    lastTrigger.current = input.trigger;
    if (input.hasTrigger && input.effect) c.play(input.effect, "once");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.trigger]);

  // Indefinite: continuous while `active`; turning false finishes the cycle, then rests.
  const effectKey = input.effect ? JSON.stringify(input.effect) : "";
  const running = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (input.active && input.effect) {
      // A mode change alone keeps the run: `sync` has already moved its spec to the new mode.
      if (running.current === effectKey && !c.disposed) return;
      running.current = effectKey;
      c.play(input.effect, "continuous");
    } else if (running.current !== undefined) {
      running.current = undefined;
      c.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.active, effectKey, input.mode]);

  // Transition: `visible` changes.
  const lastVisible = useRef(input.visible);
  useEffect(() => {
    const v = input.visible;
    if (v === undefined || Object.is(lastVisible.current, v)) return;
    lastVisible.current = v;
    c.transition(v, input.effect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.visible]);

  useImperativeHandle(
    input.effectRef,
    (): SymbolHandle => ({
      play: (e) => c.play(e, repeatOf(e)),
      stop: () => c.stop(),
    }),
    [c],
  );

  return hidden ? { style: { visibility: "hidden" }, "aria-hidden": "true" } : undefined;
}
