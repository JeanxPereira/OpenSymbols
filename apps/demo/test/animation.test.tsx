// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interpolate, pickVariant, type LayerData, type RenderMode, type SymbolData, type VariantData } from "@opensymbols/core";
import { defaultSpec, duration, loopStart, sample, toAnimDrawing, type Spec } from "@opensymbols/animate";
import { Inspector, type InspectorProps } from "../src/components/Inspector.js";
import { ChunkCache } from "../src/data/chunks.js";
import type { DemoIndex, DemoSymbol } from "../src/data/index-model.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MODES: RenderMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];

/** One 0..100 square per motion group: metric centre (50, 50), transform ×0.1, point size 20. */
function symbol(name: string, groups: number[]): SymbolData {
  const layers: LayerData[] = groups.map((g, i) => ({
    cmd: [i * 5, i * 5 + 5],
    role: "primary",
    modes: Object.fromEntries(MODES.map((m) => [m, { paint: { kind: "tint" }, opacity: 1, clearBehind: false }])) as LayerData["modes"],
    motionGroup: g,
  }));
  const v: VariantData = {
    ops: "MLLLZ".repeat(groups.length),
    argCounts: groups.flatMap(() => [2, 2, 2, 2, 0]),
    masters: {
      4: {
        args: groups.flatMap(() => [0, 0, 100, 0, 100, 100, 0, 100]),
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
  return { v: 1, name, palette: "stand-in", variants: { a0d0: v }, defaultVariant: "a0d0", modes: ["monochrome"], build: { validated: true } };
}

const demo = (name: string, component: string): DemoSymbol => ({
  name,
  component,
  aliases: [],
  categories: [],
  searchTerms: [],
  year: "2020",
  modes: ["monochrome"],
  variableValue: false,
  approximate: [],
  chunk: 0,
});

const TWO = symbol("two", [1, 2]);
const SQUARE = symbol("square", [1]);
const index: DemoIndex = {
  formatVersion: 1,
  package: { name: "fake-symbols" },
  build: {},
  palette: "stand-in",
  categories: [],
  symbols: [demo("two", "Two"), demo("square", "Square")],
  localized: [],
  skipped: [],
};
const fetchFn = (async () => ({ status: 200, json: async () => [TWO, SQUARE] })) as unknown as typeof fetch;

/** Every option each kind takes besides speed and repeat (EffectProps, Docs/format/07). */
const OPTIONS: Record<string, string[]> = {
  appear: ["direction", "byLayer"],
  disappear: ["direction", "byLayer"],
  bounce: ["direction", "byLayer"],
  pulse: ["byLayer"],
  breathe: ["breathePlain", "byLayer"],
  wiggle: ["byLayer"],
  rotate: ["rotateDirection", "byLayer"],
  scale: ["direction", "byLayer"],
  draw: ["reversed", "drawIndividually", "drawReversedOrder", "byLayer"],
};
const REPEATING = ["bounce", "pulse", "breathe", "wiggle", "rotate"];

let container: HTMLDivElement;
let root: Root;
let cache: ChunkCache;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  cache = new ChunkCache("/pkg", { fetchFn });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    if (check()) return;
    if (Date.now() > end) throw new Error("waitFor timed out");
  }
}

async function show(name: string) {
  const props: InspectorProps = { index, cache, name, gridWeight: "regular", gridMode: "monochrome", appearance: "light" };
  await act(async () => root.render(<Inspector {...props} />));
  await waitFor(() => container.querySelector(".inspector-stage svg") !== null);
}

const control = (name: string) => container.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-control="${name}"]`);
const options = () => [...container.querySelectorAll("[data-option]")].map((el) => el.getAttribute("data-option"));
const jsx = () => container.querySelector(".copy-code")!.textContent!;

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** The six numbers of a `matrix(...)` attribute, identity when absent. */
function matrixOf(el: Element): number[] {
  const t = el.getAttribute("transform");
  if (!t) return [1, 0, 0, 1, 0, 0];
  return t.slice(t.indexOf("(") + 1, t.indexOf(")")).trim().split(/[\s,]+/).map(Number);
}

describe("animation panel", () => {
  it("offers every icon effect but animated Variable Color, plus Replace", async () => {
    await show("two");
    const kinds = [...control("effect")!.options].map((o) => o.value);
    expect(kinds).toEqual(["none", ...Object.keys(OPTIONS), "replace"]);
  });

  it("each effect lists exactly its options; once/continuous only where the effect repeats", async () => {
    await show("two");
    expect(options()).toEqual([]);
    for (const [kind, expected] of Object.entries(OPTIONS)) {
      await act(async () => choose(control("effect")!, kind));
      expect(options(), kind).toEqual(expected);
      expect(control("speed"), kind).not.toBeNull();
      expect(control("repeat") !== null, kind).toBe(REPEATING.includes(kind));
    }
  });

  it("scrubbing to t writes the layer transforms of `sample(t)`", async () => {
    await show("two");
    await act(async () => choose(control("effect")!, "bounce"));
    await act(async () => choose(container.querySelector<HTMLSelectElement>('[data-option="direction"]')!, "down"));

    const v = pickVariant(TWO, "light", "ltr");
    const d = toAnimDrawing(v, interpolate(v, "regular"), "two");
    const spec: Spec = { ...defaultSpec("bounce"), direction: "down" };
    const scrub = control("scrub")!;
    expect(Number(scrub.max)).toBeCloseTo(duration(d, spec), 6);

    for (const t of [0.1, 0.25]) {
      await act(async () => setValue(scrub, String(t)));
      const states = sample(d, spec, t);
      const svg = container.querySelector(".inspector-stage svg")!;
      for (const i of [0, 1]) {
        const got = matrixOf(svg.querySelector(`[data-layer="${i}"]`)!);
        states[i]!.transform.forEach((n, k) => expect(got[k]).toBeCloseTo(n, 4));
      }
    }
    // the two motion groups are staggered: mid-bounce they differ
    const svg = container.querySelector(".inspector-stage svg")!;
    expect(svg.querySelector('[data-layer="0"]')!.getAttribute("transform")).not.toBe(
      svg.querySelector('[data-layer="1"]')!.getAttribute("transform"),
    );
  });

  it("the copied JSX carries the effect, its non-default options and the companion prop", async () => {
    await show("two");
    expect(jsx()).not.toContain("effect=");
    await act(async () => choose(control("effect")!, "bounce"));
    expect(jsx()).toContain("<Two size={128} effect={{ kind: \"bounce\" }} trigger={");
    await act(async () => choose(container.querySelector<HTMLSelectElement>('[data-option="direction"]')!, "down"));
    await act(async () => setValue(control("speed")!, "2"));
    await act(async () => choose(control("repeat")!, "continuous"));
    expect(jsx()).toContain('effect={{ kind: "bounce", direction: "down", speed: 2 }} active={');
    await act(async () => choose(control("effect")!, "appear"));
    expect(jsx()).toContain('effect={{ kind: "appear", direction: "down", speed: 2 }} visible={');
    // Reverse order is Draw Off only: once Draw Off is cleared again, the stale value reaches neither the JSX nor the preview
    await act(async () => choose(control("effect")!, "draw"));
    const opt = (k: string) => container.querySelector<HTMLInputElement>('[data-option="' + k + '"]')!;
    expect(opt("drawReversedOrder").disabled).toBe(true);
    await act(async () => opt("reversed").click());
    await act(async () => opt("drawReversedOrder").click());
    expect(jsx()).toContain("reversed: true, drawReversedOrder: true");
    await act(async () => opt("reversed").click());
    expect(opt("drawReversedOrder").disabled).toBe(true);
    expect(jsx()).not.toContain("drawReversedOrder");
  });

  it("Replace: picks a second symbol by search, with style and magic, and plays it in the stage", async () => {
    await show("two");
    await act(async () => choose(control("effect")!, "replace"));
    expect(control("scrub")).toBeNull();
    expect(control("replace-style")).not.toBeNull();
    expect(control("replace-magic")).not.toBeNull();
    await act(async () => setValue(control("replace-search")!, "squ"));
    const hit = container.querySelector<HTMLButtonElement>('[data-replace-target="square"]')!;
    expect(hit).not.toBeNull();
    await act(async () => hit.click());
    await waitFor(() => container.querySelector(".inspector-stage [data-replace]") !== null);
    expect(container.querySelector(".inspector-stage [data-replace]")!.getAttribute("data-replace")).toBe("from");
    await act(async () => control("play")!.click());
    expect(container.querySelector(".inspector-stage [data-replace]")!.getAttribute("data-replace")).toBe("to");
    // the copy block shows the Replace snippet with both components
    expect(jsx()).toContain('import { Two, Square } from "fake-symbols";');
    expect(jsx()).toContain('<Replace from={Two} to={Square} show={playing ? "to" : "from"} style="downUp" size={128} />');
  });

  it("with an effect set, the copied imports also register the effects driver", async () => {
    await show("two");
    expect(jsx()).not.toContain('import "@opensymbols/animate/react";');
    await act(async () => choose(control("effect")!, "bounce"));
    expect(jsx()).toContain(['import { Two } from "fake-symbols";', 'import "@opensymbols/animate/react";'].join("\n"));
  });

  it("continuous: the scrubber shows the loop timeline, one period past loopStart", async () => {
    await show("two");
    await act(async () => choose(control("effect")!, "bounce"));
    await act(async () => choose(control("repeat")!, "continuous"));

    const v = pickVariant(TWO, "light", "ltr");
    const d = toAnimDrawing(v, interpolate(v, "regular"), "two");
    const spec: Spec = { ...defaultSpec("bounce"), repeat: "continuous" };
    const scrub = control("scrub")!;
    const length = loopStart(d, spec) + duration(d, spec);
    expect(Number(scrub.max)).toBeCloseTo(length, 6);
    expect(length).toBeGreaterThan(duration(d, { ...spec, repeat: "once" }));

    // a time inside the loop: the continuous sample, not the once one held at rest
    const t = length - 0.05;
    await act(async () => setValue(scrub, String(t)));
    const states = sample(d, spec, t);
    const svg = container.querySelector(".inspector-stage svg")!;
    for (const i of [0, 1]) {
      const got = matrixOf(svg.querySelector(`[data-layer="${i}"]`)!);
      states[i]!.transform.forEach((n, k) => expect(got[k]).toBeCloseTo(n, 4));
    }
    expect(svg.querySelector('[data-layer="0"]')!.getAttribute("transform")).not.toBeNull();
  });
});
