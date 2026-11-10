// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createIcon, registerEffects, type EffectsInput, type SymbolHandle } from "../src/index.js";
import { layer, symbol } from "./fixture.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = symbol("two", [layer([0, 2]), layer([2, 5])]);
const Icon = createIcon(data);

describe("registerEffects", () => {
  it("hands the registered hook the effect props and the svg, and merges its svg props", async () => {
    const seen: EffectsInput[] = [];
    const played: unknown[] = [];
    registerEffects({
      useSymbolEffects(input) {
        seen.push(input);
        if (input.effectRef && typeof input.effectRef === "object") {
          (input.effectRef as { current: SymbolHandle | null }).current = { play: (e) => played.push(e), stop: () => {} };
        }
        return { style: { visibility: "hidden" }, "data-x": "1" };
      },
    });
    const handle = createRef<SymbolHandle>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<Icon effect={{ kind: "wiggle", byLayer: false }} trigger="a" active={false} visible effectRef={handle} style={{ color: "red" }} mode="palette" />),
    );
    const last = seen.at(-1)!;
    expect(last.effect).toEqual({ kind: "wiggle", byLayer: false });
    expect(last.trigger).toBe("a");
    expect(last.hasTrigger).toBe(true);
    expect(last.active).toBe(false);
    expect(last.visible).toBe(true);
    expect(last.data).toBe(data);
    // A mode the symbol lacks is drawn (and so animated) in monochrome.
    expect(last.mode).toBe("monochrome");
    expect(last.direction).toBe("ltr");
    expect(last.svg.current?.tagName.toLowerCase()).toBe("svg");
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("data-x")).toBe("1");
    expect(svg.style.visibility).toBe("hidden");
    expect(svg.style.color).toBe("red");
    for (const a of ["effect", "trigger", "active", "visible"]) expect(svg.hasAttribute(a)).toBe(false);
    handle.current!.play({ kind: "bounce" });
    expect(played).toEqual([{ kind: "bounce" }]);
    await act(async () => root.unmount());
    host.remove();
  });
});
