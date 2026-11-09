// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerData, RenderMode, SymbolData, VariantData } from "@opensymbols/core";
import { Inspector, type InspectorProps } from "../src/components/Inspector.js";
import { ChunkCache } from "../src/data/chunks.js";
import type { DemoIndex, DemoSymbol } from "../src/data/index-model.js";
import { REASONS } from "../src/reasons.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind: false };
const layer = (threshold?: number): LayerData => ({
  cmd: [0, 4],
  role: "primary",
  modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st },
  motionGroup: 0,
  ...(threshold !== undefined ? { variableThreshold: threshold } : {}),
});

function symbolData(name: string, modes: RenderMode[], threshold?: number, dark = false): SymbolData {
  const variant: VariantData = {
    ops: "MLLZ",
    argCounts: [2, 2, 2, 0],
    masters: { 4: { args: [0, 0, 10, 0, 5, 10], viewBox: [0, 0, 10, 10], transform: [1, 0, 0, 1, 0, 0] } },
    layers: [layer(threshold)],
    variableValueMode: "color",
    vcContinuous: false,
  };
  return {
    v: 1,
    name,
    palette: "stand-in",
    variants: dark ? { a0d0: variant, a1d0: variant } : { a0d0: variant },
    defaultVariant: "a0d0",
    modes,
    build: { validated: true },
  } as SymbolData;
}

const SYMBOLS: Array<{ demo: DemoSymbol; data: SymbolData }> = [
  {
    demo: {
      name: "wifi",
      component: "Wifi",
      aliases: ["wireless"],
      categories: ["connectivity"],
      searchTerms: [],
      year: "2019",
      modes: ["monochrome", "hierarchical"],
      variableValue: true,
      approximate: [],
      chunk: 0,
    },
    data: symbolData("wifi", ["monochrome", "hierarchical"], 0.5, true),
  },
  {
    demo: {
      name: "square",
      component: "Square",
      aliases: [],
      categories: [],
      searchTerms: [],
      year: "2020",
      modes: ["monochrome", "hierarchical", "multicolor", "palette"],
      variableValue: false,
      approximate: [],
      chunk: 0,
    },
    data: symbolData("square", ["monochrome", "hierarchical", "multicolor", "palette"]),
  },
];

const index: DemoIndex = {
  formatVersion: 1,
  package: { name: "fake-symbols" },
  build: {},
  palette: "stand-in",
  categories: [{ key: "connectivity", label: "Connectivity", count: 1 }],
  symbols: SYMBOLS.map((s) => s.demo),
  localized: [],
  skipped: [],
};

const fetchFn = (async () => ({ status: 200, json: async () => SYMBOLS.map((s) => s.data) })) as unknown as typeof fetch;

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

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("inspector", () => {
  it("a mode the symbol lacks is marked, selectable, and shows the mode reason", async () => {
    await show("wifi");
    const mode = control("mode")!;
    const multicolor = [...mode.options].find((o) => o.value === "multicolor")!;
    expect(multicolor.textContent).toContain("(not in this symbol)");
    expect(multicolor.disabled).toBe(false);
    expect(container.textContent).not.toContain(REASONS.mode.replace(/`/g, ""));
    await act(async () => choose(mode, "multicolor"));
    const notice = container.querySelector(".notice")!;
    expect(notice).not.toBeNull();
    expect(notice.querySelector('[data-reason="mode"]')).not.toBeNull();
    expect(notice.textContent).toContain(REASONS.mode.replace(/`/g, ""));
  });

  it("the variable value control appears only for symbols with thresholds", async () => {
    await show("wifi");
    expect(control("variable-value")).not.toBeNull();
    await show("square");
    expect(control("variable-value")).toBeNull();
  });

  it("keeps control values across selections; drops the variable value for a symbol without thresholds", async () => {
    await show("wifi");
    await act(async () => choose(control("weight")!, "bold"));
    await act(async () => control("variable-value-on")!.click());
    expect(control("variable-value")!.disabled).toBe(false);
    await show("square");
    expect(control("weight")!.value).toBe("bold");
    await show("wifi");
    expect(control("weight")!.value).toBe("bold");
    expect(control("variable-value-on")!.checked).toBe(false);
  });

  it("shows the symbol's info", async () => {
    await show("wifi");
    const info = container.querySelector(".inspector-info")!.textContent!;
    expect(info).toContain("Wifi");
    expect(info).toContain("wireless");
    expect(info).toContain("2019");
    expect(info).toContain("Connectivity");
    expect(info).toContain("Dark");
  });

  it("pins its chunk for the owner 'inspector'", async () => {
    const pin = vi.spyOn(cache, "pin");
    await show("wifi");
    expect(pin).toHaveBeenCalledWith("inspector", new Set([0]));
  });

  it("copies the JSX and announces it", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await show("wifi");
    await act(async () => choose(control("weight")!, "semibold"));
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-copy="jsx"]')!.click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<Wifi size={128} weight="semibold" />'));
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toContain("Copied");
  });
});
