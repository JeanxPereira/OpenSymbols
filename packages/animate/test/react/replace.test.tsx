// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIcon } from "@opensymbols/react";
import { defaultSpec, replaceDuration, replacePair, type Spec } from "../../src/index.js";
import { Replace } from "../../src/react/index.js";
import { liveRuns } from "../../src/react/driver.js";
import { drawingFor, flush, layerG, matrixOf, mockClock, mount, reducedMotion, symbol, type Clock } from "./fixture.js";

const play = symbol("play", [{ group: 1 }]);
const pause = symbol("pause", [{ group: 1 }, { group: 2 }]);
const Play = createIcon(play);
const Pause = createIcon(pause);

let clock: Clock;
beforeEach(() => {
  clock = mockClock();
  reducedMotion(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const close = (el: Element, m: readonly number[]) => {
  const got = matrixOf(el);
  m.forEach((v, k) => expect(got[k]).toBeCloseTo(v, 4));
};

describe("<Replace>", () => {
  it("renders both stacked, the hidden one hidden; a show change drives replacePair on both", async () => {
    const m = await mount(<Replace from={Play} to={Pause} show="from" style="upUp" />);
    const [a, b] = [...m.host.querySelectorAll("svg")];
    expect(a!.style.visibility).toBe("");
    expect(b!.style.visibility).toBe("hidden");

    clock.set(0);
    await m.render(<Replace from={Play} to={Pause} show="to" style="upUp" />);
    expect(b!.style.visibility).toBe("");
    expect(a!.style.visibility).toBe("");
    const from = drawingFor(play);
    const to = drawingFor(pause);
    const spec: Spec = { ...defaultSpec("replace"), replaceStyle: "upUp" };
    clock.frame(150);
    const p = replacePair(from, to, spec, 0.15);
    close(layerG(a!, 0), p.out[0]!.transform);
    close(layerG(b!, 0), p.in[0]!.transform);
    close(layerG(b!, 1), p.in[1]!.transform);

    // The last frame hides the source itself, before React commits: no frame shows it whole.
    clock.frameRaw(replaceDuration(from, to, spec) * 1000 + 10);
    expect(a!.style.visibility).toBe("hidden");
    expect(a!.getAttribute("aria-hidden")).toBe("true");
    expect(layerG(a!, 0).getAttribute("transform")).toBeNull();
    await flush();
    expect(liveRuns()).toBe(0);
    expect(a!.style.visibility).toBe("hidden");
    expect(b!.style.visibility).toBe("");
    for (const g of [layerG(a!, 0), layerG(b!, 0), layerG(b!, 1)]) {
      expect(g.getAttribute("transform")).toBeNull();
      expect(g.getAttribute("opacity")).toBeNull();
    }
    await m.unmount();
  });

  it("magic: passes the symbol names so Magic Replace can compare tags, and never throws", async () => {
    const m = await mount(<Replace from={Play} to={Pause} show="to" magic />);
    clock.set(0);
    await m.render(<Replace from={Play} to={Pause} show="from" magic />);
    const spec: Spec = { ...defaultSpec("magicReplace") };
    expect(drawingFor(pause).name).toBe("pause");
    clock.frame(100);
    const p = replacePair(drawingFor(pause), drawingFor(play), spec, 0.1);
    const [a, b] = [...m.host.querySelectorAll("svg")];
    close(layerG(b!, 0), p.out[0]!.transform);
    close(layerG(a!, 0), p.in[0]!.transform);
    await m.unmount();
    expect(liveRuns()).toBe(0);
  });

  it("reduced motion swaps at once", async () => {
    reducedMotion(true);
    const m = await mount(<Replace from={Play} to={Pause} show="from" />);
    await m.render(<Replace from={Play} to={Pause} show="to" />);
    const [a, b] = [...m.host.querySelectorAll("svg")];
    expect(clock.raf).not.toHaveBeenCalled();
    expect(a!.style.visibility).toBe("hidden");
    expect(b!.style.visibility).toBe("");
    await m.unmount();
  });

  it("each icon's half samples in the mode that icon is drawn in (a mode it lacks falls back to monochrome)", async () => {
    const { registerPlan } = await import("../../src/sample.js");
    const { BUILTIN_PLANS } = await import("../../src/effects/index.js");
    const seen = new Map<string, string>();
    const undo = registerPlan("replace", (dd, sp) => {
      seen.set(`${dd.name}:${sp.replaceHalf}`, sp.renderingMode);
      return BUILTIN_PLANS.replace!(dd, sp);
    });
    try {
      const lit = { ...symbol("lit", [{ group: 1 }]), modes: ["monochrome", "hierarchical"] as typeof play.modes };
      const Lit = createIcon(lit);
      const m = await mount(<Replace from={Play} to={Lit} show="from" mode="hierarchical" />);
      clock.set(0);
      await m.render(<Replace from={Play} to={Lit} show="to" mode="hierarchical" />);
      clock.frame(100);
      expect(seen.get("play:out")).toBe("monochrome");
      expect(seen.get("lit:in")).toBe("hierarchical");
      seen.clear();
      clock.set(1000);
      await m.render(<Replace from={Play} to={Lit} show="from" mode="hierarchical" />);
      clock.frame(1100);
      expect(seen.get("lit:out")).toBe("hierarchical");
      expect(seen.get("play:in")).toBe("monochrome");
      await m.unmount();
    } finally {
      undo();
    }
  });
});
