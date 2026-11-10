// @vitest-environment happy-dom
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIcon, type SymbolHandle } from "@opensymbols/react";
import type { SymbolData } from "@opensymbols/core";
import { defaultSpec, duration, loopStart, sample, type Spec } from "../../src/index.js";
import { cycleEnds, stopAt } from "../../src/sample.js";
import "../../src/react/index.js";
import { liveRuns } from "../../src/react/driver.js";
import { clipOutline } from "../../src/clip/cut.js";
import { drawingFor, layerG, maskPath, matrixOf, mockClock, mount, reducedMotion, symbol, type Clock, type Mounted } from "./fixture.js";

const two = symbol("two", [{ group: 1 }, { group: 2 }]);
const Two = createIcon(two);
const knock = symbol("knock", [{ group: 1 }, { group: 2, eraser: true }]);
const Knock = createIcon(knock);

const spec = (kind: Spec["kind"], over: Partial<Spec> = {}): Spec => ({ ...defaultSpec(kind), ...over });

/** The layer's written matrix equals the engine's `sample` at `t` (6 significant digits). */
function expectAt(el: Element, m: readonly number[]) {
  const got = matrixOf(el);
  m.forEach((v, k) => expect(got[k]).toBeCloseTo(v, 4));
}

let clock: Clock;
let mounted: Mounted[] = [];
const track = async (ui: React.ReactElement) => {
  const m = await mount(ui);
  mounted.push(m);
  return m;
};

beforeEach(() => {
  clock = mockClock();
  reducedMotion(false);
});
afterEach(async () => {
  for (const m of mounted) if (m.host.isConnected) await m.unmount();
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trigger: a discrete effect", () => {
  it("does not play on mount; a change plays a bounce whose layer transforms are `sample` at the frame time", async () => {
    const m = await track(<Two effect={{ kind: "bounce" }} trigger={0} />);
    const svg = m.host.querySelector("svg")!;
    clock.frame(16);
    expect(clock.raf).not.toHaveBeenCalled();
    expect(layerG(svg, 0).getAttribute("transform")).toBeNull();

    clock.set(1000);
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} />);
    expect(liveRuns()).toBe(1);
    const d = drawingFor(two);
    const s = spec("bounce");
    for (const t of [0.1, 0.25, 0.4]) {
      clock.frame(1000 + t * 1000);
      const states = sample(d, s, t);
      for (const i of [0, 1]) expectAt(layerG(svg, i), states[i]!.transform);
    }
    // by layer: the two groups are staggered, so they differ mid-bounce
    expect(layerG(svg, 0).getAttribute("transform")).not.toBe(layerG(svg, 1).getAttribute("transform"));
    // nothing else is written: no opacity, no display, the path untouched
    expect(layerG(svg, 0).getAttribute("opacity")).toBeNull();
    expect(layerG(svg, 0).querySelector("path")!.getAttribute("d")).toBe("M0 0L100 0L100 100L0 100Z");

    // past the end: the layers settle back to their static markup and the run leaves the loop
    clock.frame(1000 + duration(d, s) * 1000 + 16);
    for (const i of [0, 1]) expect(layerG(svg, i).getAttribute("transform")).toBeNull();
    expect(liveRuns()).toBe(0);
    expect(clock.pending()).toBe(0);
  });

  it("the effect's options reach the spec (direction, byLayer, speed)", async () => {
    const m = await track(<Two effect={{ kind: "bounce", direction: "down", byLayer: false, speed: 2 }} trigger={0} />);
    clock.set(0);
    await m.render(<Two effect={{ kind: "bounce", direction: "down", byLayer: false, speed: 2 }} trigger={1} />);
    clock.frame(100);
    const st = sample(drawingFor(two), spec("bounce", { direction: "down", byLayer: false, speed: 2 }), 0.1);
    const svg = m.host.querySelector("svg")!;
    expectAt(layerG(svg, 0), st[0]!.transform);
    expectAt(layerG(svg, 1), st[1]!.transform);
  });
});

describe("one shared loop", () => {
  it("many animating icons share one requestAnimationFrame per frame", async () => {
    const ms: Mounted[] = [];
    for (let k = 0; k < 3; k++) ms.push(await track(<Two effect={{ kind: "pulse" }} trigger={0} />));
    for (const m of ms) await m.render(<Two effect={{ kind: "pulse" }} trigger={1} />);
    expect(liveRuns()).toBe(3);
    expect(clock.pending()).toBe(1);
    clock.frame(100);
    expect(clock.pending()).toBe(1);
  });
});

describe("active: a continuous effect", () => {
  it("runs past one cycle while active, then finishes each group's cycle, plays the outro and rests", async () => {
    const e = { kind: "bounce" } as const;
    clock.set(0);
    const m = await track(<Two effect={e} active />);
    const svg = m.host.querySelector("svg")!;
    const d = drawingFor(two);
    const s = spec("bounce", { repeat: "continuous" });
    const t1 = loopStart(d, s) + 3.3 * duration(d, s);
    clock.frame(t1 * 1000);
    const st = sample(d, s, t1);
    expectAt(layerG(svg, 0), st[0]!.transform);
    expectAt(layerG(svg, 1), st[1]!.transform);

    clock.set(t1 * 1000);
    await m.render(<Two effect={e} active={false} />);
    const ends = cycleEnds(d, s, t1)!;
    expect(Math.min(...ends)).toBeGreaterThan(t1);
    // still moving inside the current cycle, on the same clock
    const mid = Math.min(...ends) - 0.01;
    clock.frame(mid * 1000);
    expectAt(layerG(svg, 0), sample(d, s, mid)[0]!.transform);
    // past every group's cycle end and outro (07 §7.1): at rest, off the loop
    const halt = stopAt(d, s, t1)!;
    expect(halt.end).toBeGreaterThan(Math.max(...ends));
    clock.frame((halt.end + 0.001) * 1000);
    expect(layerG(svg, 0).getAttribute("transform")).toBeNull();
    expect(layerG(svg, 1).getAttribute("transform")).toBeNull();
    expect(liveRuns()).toBe(0);
  });

  it("cycleEnds: each group ends on a boundary of its own delayed clock", () => {
    const d = drawingFor(two);
    const s = spec("bounce", { repeat: "continuous" });
    const t = loopStart(d, s) + 1.3 * duration(d, s);
    const ends = cycleEnds(d, s, t)!;
    expect(ends).toHaveLength(2);
    for (const e of ends) {
      expect(e).toBeGreaterThanOrEqual(t);
      expect(e - t).toBeLessThanOrEqual(duration(d, s) + 1e-9);
    }
    expect(cycleEnds(d, spec("bounce"), t)).toBeUndefined();
  });
});

describe("knockouts (Review Focus 3)", () => {
  it("two knockout icons each move their own mask copy with their own knockout layer", async () => {
    const a = await track(<Knock effect={{ kind: "bounce" }} trigger={0} />);
    const b = await track(<Knock effect={{ kind: "bounce" }} trigger={0} />);
    const svgA = a.host.querySelector("svg")!;
    const svgB = b.host.querySelector("svg")!;
    expect(svgA.querySelector("mask")!.id).not.toBe(svgB.querySelector("mask")!.id);
    // the knockout layer is not painted: it lives only in the mask
    expect(svgA.querySelector('g[data-layer="1"]')).toBeNull();

    clock.set(0);
    await a.render(<Knock effect={{ kind: "bounce" }} trigger={1} />);
    clock.set(200);
    await b.render(<Knock effect={{ kind: "bounce" }} trigger={1} />);
    clock.frame(300);
    const d = drawingFor(knock);
    const s = spec("bounce");
    const atA = sample(d, s, 0.3);
    const atB = sample(d, s, 0.1);
    expectAt(maskPath(svgA, 1), atA[1]!.transform);
    expectAt(maskPath(svgB, 1), atB[1]!.transform);
    expectAt(layerG(svgA, 0), atA[0]!.transform);
    expectAt(layerG(svgB, 0), atB[0]!.transform);
    expect(maskPath(svgA, 1).getAttribute("transform")).not.toBe(maskPath(svgB, 1).getAttribute("transform"));
  });
});

describe("unmount (Review Focus 5)", () => {
  it("unmounting mid-animation leaves the loop and writes nothing more", async () => {
    const m = await track(<Two effect={{ kind: "bounce" }} trigger={0} />);
    clock.set(0);
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} />);
    clock.frame(100);
    expect(liveRuns()).toBe(1);
    const svg = m.host.querySelector("svg")!;
    await m.unmount();
    expect(liveRuns()).toBe(0);
    const writes = vi.spyOn(Element.prototype, "setAttribute");
    const removes = vi.spyOn(Element.prototype, "removeAttribute");
    clock.frame(200);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(svg.isConnected).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it("an icon detached without its cleanup is dropped at the next frame, unwritten", async () => {
    const m = await track(<Two effect={{ kind: "bounce" }} trigger={0} />);
    clock.set(0);
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} />);
    m.host.remove();
    const writes = vi.spyOn(Element.prototype, "setAttribute");
    clock.frame(100);
    expect(writes).not.toHaveBeenCalled();
    expect(liveRuns()).toBe(0);
  });
});

describe("visible: appear and disappear", () => {
  it("false plays Disappear and keeps the icon mounted but hidden; true plays Appear", async () => {
    const e = { kind: "disappear", direction: "down" } as const;
    clock.set(0);
    const m = await track(<Two effect={e} visible />);
    const svg = m.host.querySelector("svg")!;
    await m.render(<Two effect={e} visible={false} />);
    const d = drawingFor(two);
    const s = spec("disappear", { direction: "down" });
    clock.frame(100);
    expectAt(layerG(svg, 0), sample(d, s, 0.1)[0]!.transform);
    clock.frame(duration(d, s) * 1000 + 10);
    expect(m.host.querySelector("svg")).toBe(svg);
    expect(svg.style.visibility).toBe("hidden");
    expect(svg.getAttribute("aria-hidden")).toBe("true");

    clock.set(5000);
    await m.render(<Two effect={e} visible />);
    expect(svg.style.visibility).toBe("");
    const a = spec("appear", { direction: "down" });
    clock.frame(5050);
    expectAt(layerG(svg, 0), sample(d, a, 0.05)[0]!.transform);
    clock.frame(5000 + duration(d, a) * 1000 + 10);
    expect(layerG(svg, 0).getAttribute("transform")).toBeNull();
    expect(layerG(svg, 0).getAttribute("opacity")).toBeNull();
  });

  it("mounted with visible={false}, the icon starts hidden without animating", async () => {
    const m = await track(<Two effect={{ kind: "appear" }} visible={false} />);
    expect(m.host.querySelector("svg")!.style.visibility).toBe("hidden");
    expect(clock.raf).not.toHaveBeenCalled();
  });
});

describe("prefers-reduced-motion", () => {
  it("jumps to the end state: Disappear is hidden at once, a bounce never runs", async () => {
    reducedMotion(true);
    const m = await track(<Two effect={{ kind: "bounce" }} trigger={0} visible />);
    const svg = m.host.querySelector("svg")!;
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} visible />);
    expect(clock.raf).not.toHaveBeenCalled();
    expect(layerG(svg, 0).getAttribute("transform")).toBeNull();

    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} visible={false} />);
    const d = drawingFor(two);
    const s = spec("disappear");
    const end = sample(d, s, duration(d, s))[0]!;
    expect(clock.raf).not.toHaveBeenCalled();
    expect(svg.style.visibility).toBe("hidden");
    expectAt(layerG(svg, 0), end.transform);
    expect(end.visible).toBe(false);
    expect(layerG(svg, 0).getAttribute("display")).toBe("none");
    expect(Number(layerG(svg, 0).getAttribute("opacity"))).toBeCloseTo(end.alpha, 5);
    expect(liveRuns()).toBe(0);
  });
});

describe("effectRef", () => {
  it("play() starts an effect, stop() ends a continuous one gracefully", async () => {
    const h = createRef<SymbolHandle>();
    const m = await track(<Two effectRef={h} />);
    const svg = m.host.querySelector("svg")!;
    clock.set(0);
    h.current!.play({ kind: "wiggle", repeat: "continuous" });
    const d = drawingFor(two);
    const s = spec("wiggle", { repeat: "continuous" });
    const t = loopStart(d, s) + 2.5 * duration(d, s);
    clock.frame(t * 1000);
    expectAt(layerG(svg, 0), sample(d, s, t)[0]!.transform);
    h.current!.stop();
    clock.frame((Math.max(...cycleEnds(d, s, t)!) + 0.01) * 1000);
    expect(layerG(svg, 0).getAttribute("transform")).toBeNull();
    expect(liveRuns()).toBe(0);
  });

  it("a bad speed throws from play(), not inside the loop", async () => {
    const h = createRef<SymbolHandle>();
    await track(<Two effectRef={h} />);
    expect(() => h.current!.play({ kind: "bounce", speed: 0 })).toThrow(RangeError);
    expect(liveRuns()).toBe(0);
  });
});

describe("draw: the clipped outline", () => {
  it("replaces a stroke-clipped layer's d while drawing and restores it at the end", async () => {
    const bars = symbol("bars", [{ group: 1, len: 95 }]);
    const Bars = createIcon(bars);
    const h = createRef<SymbolHandle>();
    const m = await track(<Bars effectRef={h} />);
    const path = m.host.querySelector('g[data-layer="0"] path')!;
    const whole = path.getAttribute("d");
    clock.set(0);
    h.current!.play({ kind: "draw" });
    const d = drawingFor(bars);
    const s = spec("draw");
    const t = duration(d, s) / 2;
    clock.frame(t * 1000);
    const st = sample(d, s, t)[0]!;
    expect(st.strokeClip).toBe(true);
    expect(path.getAttribute("d")).not.toBe(whole);
    clock.frame(duration(d, s) * 1000 + 10);
    expect(path.getAttribute("d")).toBe(whole);
    expect(liveRuns()).toBe(0);
  });

  it("a weight change mid-draw restores the new weight's outline at the end", async () => {
    const bars = symbol("bars", [{ group: 1, len: 95 }]);
    // a second master with a longer bar, so the weights differ
    const v = bars.variants.a0d0!;
    const m4 = v.masters[4]!;
    v.masters[9] = { ...m4, args: [0, 0, 190, 0, 190, 5, 0, 5] };
    const Bars = createIcon(bars);
    const h = createRef<SymbolHandle>();
    const m = await track(<Bars effectRef={h} />);
    clock.set(0);
    h.current!.play({ kind: "draw" });
    clock.frame(100);
    await m.render(<Bars effectRef={h} weight="black" />);
    const path = m.host.querySelector('g[data-layer="0"] path')!;
    clock.frame(5000);
    expect(liveRuns()).toBe(0);
    expect(path.getAttribute("d")).toBe("M0 0L190 0L190 5L0 5Z");
  });
});

describe("fix round 1", () => {
  it("an interrupted Disappear still leaves the icon hidden (a trigger mid-way)", async () => {
    clock.set(0);
    const m = await track(<Two effect={{ kind: "bounce" }} trigger={0} visible />);
    const svg = m.host.querySelector("svg")!;
    await m.render(<Two effect={{ kind: "bounce" }} trigger={0} visible={false} />);
    clock.frame(50);
    expect(svg.style.visibility).toBe("");
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} visible={false} />);
    expect(svg.style.visibility).toBe("hidden");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // the Disappear's end state, and no bounce on the hidden icon
    expect(layerG(svg, 0).getAttribute("display")).toBe("none");
    expect(liveRuns()).toBe(0);
    clock.frame(300);
    expect(layerG(svg, 0).getAttribute("display")).toBe("none");
    // Appear brings it back
    clock.set(1000);
    await m.render(<Two effect={{ kind: "bounce" }} trigger={1} visible />);
    expect(svg.style.visibility).toBe("");
    expect(liveRuns()).toBe(1);
  });

  it("a trigger during `active` plays once, then the continuous effect resumes", async () => {
    const e = { kind: "bounce" } as const;
    clock.set(0);
    const m = await track(<Two effect={e} trigger={0} active />);
    const svg = m.host.querySelector("svg")!;
    clock.set(1000);
    await m.render(<Two effect={e} trigger={1} active />);
    const d = drawingFor(two);
    const once = spec("bounce");
    const cont = spec("bounce", { repeat: "continuous" });
    clock.frame(1100);
    expectAt(layerG(svg, 0), sample(d, once, 0.1)[0]!.transform);
    const endMs = 1000 + duration(d, once) * 1000 + 5;
    clock.frame(endMs);
    expect(liveRuns()).toBe(1);
    clock.frame(endMs + 300);
    expectAt(layerG(svg, 0), sample(d, cont, 0.3)[0]!.transform);
    expectAt(layerG(svg, 1), sample(d, cont, 0.3)[1]!.transform);
  });

  it("StrictMode with active on mount: exactly one live run, and frames advance", async () => {
    clock.set(0);
    const m = await track(
      <StrictMode>
        <Two effect={{ kind: "bounce" }} active />
      </StrictMode>,
    );
    expect(liveRuns()).toBe(1);
    expect(clock.pending()).toBe(1);
    const svg = m.host.querySelector("svg")!;
    const cont = spec("bounce", { repeat: "continuous" });
    for (const ms of [120, 480]) {
      clock.frame(ms);
      expectAt(layerG(svg, 0), sample(drawingFor(two), cont, ms / 1000)[0]!.transform);
    }
    expect(liveRuns()).toBe(1);
  });

  it("frames reuse the cached layer elements (no DOM query per frame)", async () => {
    const m = await track(<Knock effect={{ kind: "bounce" }} trigger={0} />);
    clock.set(0);
    await m.render(<Knock effect={{ kind: "bounce" }} trigger={1} />);
    clock.frame(16);
    const q = vi.spyOn(Element.prototype, "querySelectorAll");
    const q1 = vi.spyOn(Element.prototype, "querySelector");
    for (const ms of [32, 48, 64]) clock.frame(ms);
    expect(q).not.toHaveBeenCalled();
    expect(q1).not.toHaveBeenCalled();
    q.mockRestore();
    q1.mockRestore();
    expect(maskPath(m.host.querySelector("svg")!, 1).getAttribute("transform")).not.toBeNull();
  });

  it("a weight change mid-draw writes the new geometry's clip at once (no full-outline frame)", async () => {
    const bars = symbol("bars", [{ group: 1, len: 95 }]);
    const v = bars.variants.a0d0!;
    v.masters[9] = { ...v.masters[4]!, args: [0, 0, 190, 0, 190, 5, 0, 5] };
    const Bars = createIcon(bars);
    const h = createRef<SymbolHandle>();
    const m = await track(<Bars effectRef={h} />);
    clock.set(0);
    h.current!.play({ kind: "draw" });
    clock.frame(100);
    clock.set(150);
    await m.render(<Bars effectRef={h} weight="black" />);
    const path = m.host.querySelector('g[data-layer="0"] path')!;
    const heavy = drawingFor({ ...bars, variants: { a0d0: { ...v, masters: { 4: v.masters[9]! } } } });
    const st = sample(heavy, spec("draw"), 0.15)[0]!;
    expect(st.strokeClip).toBe(true);
    const l = heavy.layers[0]!;
    expect(path.getAttribute("d")).toBe(clipOutline(l.path.ops, l.path.argCounts, l.path.args, [0, l.path.ops.length], l.strokeKeyframes, st.strokeStart, st.strokeEnd));
    expect(path.getAttribute("d")).not.toBe("M0 0L190 0L190 5L0 5Z");
  });

  it("a held Draw Off end state stays clipped after a re-render", async () => {
    const bars = symbol("bars", [{ group: 1, len: 95 }]);
    const v = bars.variants.a0d0!;
    v.masters[9] = { ...v.masters[4]!, args: [0, 0, 190, 0, 190, 5, 0, 5] };
    const Bars = createIcon(bars);
    const h = createRef<SymbolHandle>();
    const m = await track(<Bars effectRef={h} />);
    clock.set(0);
    h.current!.play({ kind: "draw", reversed: true });
    clock.frame(5000);
    expect(liveRuns()).toBe(0);
    const path = m.host.querySelector('g[data-layer="0"] path')!;
    expect(path.getAttribute("d")).not.toBe("M0 0L95 0L95 5L0 5Z");
    await m.render(<Bars effectRef={h} weight="black" />);
    expect(path.getAttribute("d")).not.toBe("M0 0L190 0L190 5L0 5Z");
    const heavy = drawingFor({ ...bars, variants: { a0d0: { ...v, masters: { 4: v.masters[9]! } } } });
    const s = spec("draw", { reversed: true });
    const st = sample(heavy, s, duration(heavy, s))[0]!;
    const l = heavy.layers[0]!;
    expect(path.getAttribute("d")).toBe(clipOutline(l.path.ops, l.path.argCounts, l.path.args, [0, l.path.ops.length], l.strokeKeyframes, st.strokeStart, st.strokeEnd));
  });
});

describe("renderFrame: one frame at a chosen time (a timeline scrubber)", () => {
  it("writes `sample(t)` through the driver's write path; a frame at rest restores the static markup", async () => {
    const { renderFrame, drawingOf, toSpec } = await import("../../src/react/index.js");
    const bars = symbol("bars", [{ group: 1, len: 95 }, { group: 2 }]);
    const Bars = createIcon(bars);
    const m = await track(<Bars />);
    const svg = m.host.querySelector("svg")!;
    const d = drawingOf({ data: bars, weight: "regular", appearance: "light", direction: "ltr" });
    expect(d).toEqual(drawingFor(bars));
    const s = toSpec({ kind: "draw" }, { mode: "monochrome", appearance: "light" }, "once");
    expect(s).toEqual(spec("draw"));

    const st = sample(d, s, 0.15);
    renderFrame(svg, d, st);
    const path = layerG(svg, 0).querySelector("path")!;
    const l = d.layers[0]!;
    expect(path.getAttribute("d")).toBe(clipOutline(l.path.ops, l.path.argCounts, l.path.args, [0, l.path.ops.length], l.strokeKeyframes, st[0]!.strokeStart, st[0]!.strokeEnd));
    expect(liveRuns()).toBe(0);

    const b = toSpec({ kind: "bounce" }, { mode: "monochrome", appearance: "light" }, "once");
    const bt = sample(d, b, 0.2);
    renderFrame(svg, d, bt);
    for (const i of [0, 1]) expectAt(layerG(svg, i), bt[i]!.transform);
    // bounce draws the whole outline: the clip of the earlier frame is undone
    expect(path.getAttribute("d")).toBe("M0 0L95 0L95 5L0 5Z");

    renderFrame(svg, d, sample(d, b, 0));
    for (const i of [0, 1]) expect(layerG(svg, i).getAttribute("transform")).toBeNull();
  });
});

describe("final review fixes", () => {
  /** The written scale of a layer (the matrix's `a`; Bounce only scales). */
  const scaleOf = (el: Element) => matrixOf(el)[0]!;

  for (const direction of ["up", "down"] as const) {
    it(`stopping a continuous Bounce (${direction}) plays the outro: no jump across the stop, ends at 1`, async () => {
      const e = { kind: "bounce", direction } as const;
      clock.set(0);
      const m = await track(<Two effect={e} active />);
      const svg = m.host.querySelector("svg")!;
      const d = drawingFor(two);
      const s = spec("bounce", { repeat: "continuous", direction });
      const dt = 1000 / 60;
      const t1 = loopStart(d, s) + 2.4 * duration(d, s);
      // the largest frame-to-frame step while it runs
      let prev = [scaleOf(layerG(svg, 0)), scaleOf(layerG(svg, 1))];
      let running = 0;
      let ms = 0;
      for (; ms + dt <= t1 * 1000; ) {
        ms += dt;
        clock.frame(ms);
        const cur = [scaleOf(layerG(svg, 0)), scaleOf(layerG(svg, 1))];
        cur.forEach((v, i) => (running = Math.max(running, Math.abs(v - prev[i]!))));
        prev = cur;
      }
      clock.set(ms);
      await m.render(<Two effect={e} active={false} />);
      let worst = 0;
      for (let k = 0; k < 120 && liveRuns() > 0; k++) {
        ms += dt;
        clock.frame(ms);
        const cur = [scaleOf(layerG(svg, 0)), scaleOf(layerG(svg, 1))];
        cur.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - prev[i]!))));
        prev = cur;
      }
      expect(liveRuns()).toBe(0);
      // continuity: no step across the stop larger than the effect's own steps while running
      expect(worst).toBeLessThanOrEqual(running + 1e-3);
      expect(worst).toBeLessThan(0.03);
      // ends at 1, the static markup
      for (const i of [0, 1]) expect(layerG(svg, i).getAttribute("transform")).toBeNull();
    });
  }

  it("a continuous run dropped from the loop (an error in a frame) does not throw on the next render", async () => {
    const { registerPlan } = await import("../../src/sample.js");
    const { BUILTIN_PLANS } = await import("../../src/effects/index.js");
    // A pulse whose loop yields a non-finite scale after 0.1 s: the frame throws inside the loop.
    const undo = registerPlan("pulse", (dd, sp) => {
      const p = BUILTIN_PLANS.pulse!(dd, sp);
      if (sp.repeat !== "continuous") return p;
      return { ...p, tracks: [], loop: { period: 1, tracks: [{ property: "scale", start: 0.1, from: 1, segments: [{ duration: 0.1, curve: 0, to: NaN }] }] } };
    });
    const reported: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => {
      try {
        cb();
      } catch (err) {
        reported.push(err);
      }
    });
    try {
      clock.set(0);
      const m = await track(<Two effect={{ kind: "pulse" }} active />);
      const svg = m.host.querySelector("svg")!;
      clock.frame(50);
      clock.frame(150);
      expect(reported).toHaveLength(1);
      expect(liveRuns()).toBe(0);
      await expect(m.render(<Two effect={{ kind: "pulse" }} active weight="bold" />)).resolves.toBeUndefined();
      for (const i of [0, 1]) {
        expect(layerG(svg, i).getAttribute("transform")).toBeNull();
        expect(layerG(svg, i).getAttribute("opacity")).toBeNull();
      }
    } finally {
      undo();
    }
  });

  it("a continuous run dropped because its svg was detached does not throw once reattached and re-rendered", async () => {
    clock.set(0);
    const m = await track(<Two effect={{ kind: "bounce" }} active />);
    const svg = m.host.querySelector("svg")!;
    clock.frame(100);
    m.host.remove();
    clock.frame(150);
    expect(liveRuns()).toBe(0);
    document.body.appendChild(m.host);
    await expect(m.render(<Two effect={{ kind: "bounce" }} active weight="bold" />)).resolves.toBeUndefined();
    for (const i of [0, 1]) expect(layerG(svg, i).getAttribute("transform")).toBeNull();
  });

  it("a rendering-mode change mid-run reaches the running spec without restarting it", async () => {
    const { registerPlan } = await import("../../src/sample.js");
    const { BUILTIN_PLANS } = await import("../../src/effects/index.js");
    const seen: string[] = [];
    const undo = registerPlan("wiggle", (dd, sp) => {
      seen.push(sp.renderingMode);
      return BUILTIN_PLANS.wiggle!(dd, sp);
    });
    try {
      const two2 = { ...symbol("two2", [{ group: 1 }, { group: 2 }]), modes: ["monochrome", "hierarchical"] as SymbolData["modes"] };
      const Two2 = createIcon(two2);
      const e = { kind: "wiggle" } as const;
      clock.set(0);
      const m = await track(<Two2 effect={e} active />);
      const svg = m.host.querySelector("svg")!;
      clock.frame(200);
      expect(seen.at(-1)).toBe("monochrome");
      const raf = clock.raf.mock.calls.length;
      clock.set(250);
      await m.render(<Two2 effect={e} active mode="hierarchical" />);
      expect(seen.at(-1)).toBe("hierarchical");
      // the same run, on the same clock: the frame is the continuous sample at 0.3 s
      clock.frame(300);
      const s = spec("wiggle", { repeat: "continuous", renderingMode: "hierarchical" });
      expectAt(layerG(svg, 0), sample(drawingFor(two2), s, 0.3)[0]!.transform);
      expect(liveRuns()).toBe(1);
      expect(clock.raf.mock.calls.length).toBeGreaterThan(raf);
    } finally {
      undo();
    }
  });
});
