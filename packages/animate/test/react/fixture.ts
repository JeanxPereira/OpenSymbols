import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { interpolate, pickVariant, type LayerData, type RenderMode, type SymbolData, type VariantData } from "@opensymbols/core";
import { toAnimDrawing, type AnimDrawing } from "../../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

interface L {
  group: number;
  eraser?: boolean;
  /** Stroke keyframes so Draw clips the layer (a bar `len` long, 5 thick). */
  len?: number;
}

/**
 * One layer per entry: a 0..100 square (or a bar with stroke keyframes), metric centre (50, 50),
 * transform ×0.1, point size 20.
 */
export function symbol(name: string, spec: L[]): SymbolData {
  const ops = "MLLLZ".repeat(spec.length);
  const argCounts = spec.flatMap(() => [2, 2, 2, 2, 0]);
  const args = spec.flatMap((l) => (l.len !== undefined ? [0, 0, l.len, 0, l.len, 5, 0, 5] : [0, 0, 100, 0, 100, 100, 0, 100]));
  const layers: LayerData[] = spec.map((l, i) => {
    const total = l.len !== undefined ? 2 * l.len + 10 : 0;
    return {
      cmd: [i * 5, i * 5 + 5],
      role: "primary",
      modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: l.eraser === true }])) as LayerData["modes"],
      motionGroup: l.group,
      anim:
        l.len !== undefined
          ? {
              strokeKeyframes: [
                { flags: 0, progress: 0, d0: 0, d1: (2 * l.len + 5) / total },
                { flags: 0, progress: 1, d0: l.len / total, d1: (l.len + 5) / total },
              ],
            }
          : {},
    };
  });
  const v: VariantData = {
    ops,
    argCounts,
    masters: {
      4: {
        args,
        viewBox: [0, 0, 20, 20],
        transform: [0.1, 0, 0, 0.1, 0, 0],
        metrics: { referencePointSize: 20, baselineOffset: 0, capHeight: 10, leftInset: 0, rightInset: 0 },
        metricCenter: [50, 50],
        rotationAnchor: [10, 20],
      },
    },
    layers,
    variableValueMode: "color",
    vcContinuous: false,
    anim: {},
  };
  return { v: 1, name, palette: "apple", variants: { a0d0: v }, defaultVariant: "a0d0", modes: ["monochrome"], build: { validated: true } };
}

/** The drawing the driver animates for `data` at regular, light, ltr. */
export function drawingFor(data: SymbolData): AnimDrawing {
  const v = pickVariant(data, "light", "ltr");
  return toAnimDrawing(v, interpolate(v, "regular"), data.name);
}

// ---- a mocked clock and frame loop ----

export interface Clock {
  /** Runs one animation frame at `ms` (also what `performance.now()` returns from then on). */
  frame(ms: number): void;
  /**
   * Runs one frame outside `act`, so a test sees the DOM exactly as the frame left it, before React
   * commits any state the frame scheduled. Follow with `await flush()`.
   */
  frameRaw(ms: number): void;
  /** Sets `performance.now()` without running a frame. */
  set(ms: number): void;
  pending(): number;
  raf: ReturnType<typeof vi.fn>;
}

export function mockClock(): Clock {
  let nowMs = 0;
  let id = 0;
  const cbs = new Map<number, FrameRequestCallback>();
  const raf = vi.fn((cb: FrameRequestCallback) => {
    cbs.set(++id, cb);
    return id;
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", (h: number) => cbs.delete(h));
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  return {
    frame(ms) {
      nowMs = ms;
      const list = [...cbs.values()];
      cbs.clear();
      act(() => {
        for (const cb of list) cb(ms);
      });
    },
    frameRaw(ms) {
      nowMs = ms;
      const list = [...cbs.values()];
      cbs.clear();
      const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      g.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        for (const cb of list) cb(ms);
      } finally {
        g.IS_REACT_ACT_ENVIRONMENT = true;
      }
    },
    set(ms) {
      nowMs = ms;
    },
    pending: () => cbs.size,
    raf,
  };
}

export function reducedMotion(on: boolean): void {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("prefers-reduced-motion: reduce"), media: q }));
}

// ---- mounting ----

export interface Mounted {
  host: HTMLElement;
  root: Root;
  render(ui: React.ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

export async function mount(ui: React.ReactElement): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const m: Mounted = {
    host,
    root,
    async render(next) {
      await act(async () => root.render(next));
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
  await m.render(ui);
  return m;
}

/** The numbers of a `matrix(a b c d e f)` attribute, or the identity when absent. */
export function matrixOf(el: Element | null | undefined): number[] {
  const v = el?.getAttribute("transform");
  if (!v) return [1, 0, 0, 1, 0, 0];
  const m = /^matrix\(([^)]*)\)$/.exec(v);
  if (!m) throw new Error(`not a matrix: ${v}`);
  return m[1]!.split(" ").map(Number);
}

/** The layer group `i` (`<g data-layer>`) of `svg`. */
export const layerG = (svg: Element, i: number): Element => svg.querySelector(`g[data-layer="${i}"]`)!;
/** The mask copy of knockout layer `i`. */
export const maskPath = (svg: Element, i: number): Element => svg.querySelector(`mask path[data-layer="${i}"]`)!;

/** Lets React commit whatever is pending. */
export async function flush(): Promise<void> {
  await act(async () => {});
}
