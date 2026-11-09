// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerData, SymbolData } from "@opensymbols/core";
import { App } from "../src/App.js";
import { ChunkCache } from "../src/data/chunks.js";
import type { DemoIndex, DemoSymbol } from "../src/data/index-model.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COUNT = 1000;
const PER_CHUNK = 200;
const nameAt = (i: number) => (i % 10 === 0 ? `ring.${i}` : `square.${i}`);

function demoSymbol(i: number, name = nameAt(i)): DemoSymbol {
  return {
    name,
    component: name,
    aliases: i === 3 ? ["box"] : [],
    categories: ["shapes"],
    searchTerms: [],
    year: "2019",
    modes: ["monochrome", "hierarchical"],
    variableValue: false,
    approximate: [],
    chunk: Math.floor(i / PER_CHUNK),
  };
}

function makeIndex(count: number, name: (i: number) => string = nameAt): DemoIndex {
  return {
    formatVersion: 1,
    package: { name: "fake-symbols" },
    build: {},
    palette: "stand-in",
    categories: [{ key: "shapes", label: "Shapes", count }],
    symbols: Array.from({ length: count }, (_, i) => demoSymbol(i, name(i))),
    localized: [],
    skipped: [],
  };
}

const index = makeIndex(COUNT);

const layer = (): LayerData => {
  const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind: false };
  return { cmd: [0, 3], role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 };
};
function symbolData(name: string): SymbolData {
  return {
    v: 1,
    name,
    palette: "stand-in",
    variants: {
      a0d0: {
        ops: "MLLZ",
        argCounts: [2, 2, 2, 0],
        masters: {
          4: {
            args: [0, 0, 10, 0, 5, 10],
            viewBox: [0, 0, 10, 10],
            transform: [1, 0, 0, 1, 0, 0],
            metrics: { referencePointSize: 17, baselineOffset: 3, capHeight: 10, leftInset: 0, rightInset: 0 },
          },
        },
        layers: [layer()],
        variableValueMode: "color",
        vcContinuous: false,
      },
    },
    defaultVariant: "a0d0",
    modes: ["monochrome"],
    build: { validated: false },
  } as SymbolData;
}

const json = (body: unknown, status = 200) => ({ status, json: async () => body }) as Response;

/** index.json plus chunks; `failChunks` answer 500 until removed from the set; chunk URLs go to `log`. */
function fakeFetch(idx: DemoIndex, failChunks = new Set<number>(), log: string[] = []) {
  return (async (url: string) => {
    if (url.endsWith("/index.json")) return json(idx);
    const m = /chunks\/(\d+)\.json$/.exec(url);
    if (!m) return json(null, 404);
    const n = Number(m[1]);
    log.push(url);
    // A refetch loop would never settle: stop answering so the test fails instead of hanging.
    if (log.length > 100) return new Promise<Response>(() => {});
    if (failChunks.has(n)) return json(null, 500);
    const start = n * PER_CHUNK;
    return json(idx.symbols.slice(start, start + PER_CHUNK).map((s) => symbolData(s.name)));
  }) as unknown as typeof fetch;
}

class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb([{ target, contentRect: { width: 800, height: 600 } } as unknown as ResizeObserverEntry], this as never);
  }
  unobserve() {}
  disconnect() {}
}

let viewWidth = 800;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => viewWidth });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  // Browsers fire "scroll" after a programmatic scroll; happy-dom does not.
  const scrollTo = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, ...args: unknown[]) {
    (scrollTo as (...a: unknown[]) => void).apply(this, args);
    this.dispatchEvent(new Event("scroll"));
  } as typeof scrollTo;
  // No layout in happy-dom: an element is as tall as its first child's inline height (the virtual grid).
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const child = this.firstElementChild as HTMLElement | null;
      return Math.max(600, parseFloat(child?.style.height ?? "") || 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  viewWidth = 800;
  history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-theme");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    let ok = false;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    try {
      ok = check();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() > end) throw new Error("waitFor timed out");
  }
}

async function mount(opts: { fail?: Set<number>; index?: DemoIndex; capacity?: number; log?: string[] } = {}) {
  const idx = opts.index ?? index;
  const cache = new ChunkCache("/pkg", {
    fetchFn: fakeFetch(idx, opts.fail, opts.log),
    ...(opts.capacity !== undefined ? { capacity: opts.capacity } : {}),
  });
  await act(async () => {
    root.render(<App base="/pkg" fetchFn={fakeFetch(idx)} createCache={() => cache} />);
  });
  await waitFor(() => cells().length > 0);
  return cache;
}

const cells = () => [...container.querySelectorAll<HTMLElement>('[role="gridcell"]')];
const cellButton = (name: string) => container.querySelector<HTMLButtonElement>(`button[title="${name}"]`);
const gridcellOf = (name: string) => cellButton(name)?.closest('[role="gridcell"]');
const status = () => container.querySelector('[role="status"]')?.textContent ?? "";

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

describe("demo app", () => {
  it("virtualizes: 1,000 symbols render fewer than 200 cells", async () => {
    await mount();
    expect(cells().length).toBeGreaterThan(0);
    expect(cells().length).toBeLessThan(200);
    expect(status()).toContain("1,000");
    // icons render once their chunk lands
    await waitFor(() => container.querySelector('[role="gridcell"] svg') !== null);
  });

  it("typing in the search field filters the grid", async () => {
    await mount();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => typeInto(input, "ring"));
    await waitFor(() => status().includes("100"));
    const names = cells().map((c) => c.querySelector("button[title]")!.getAttribute("title"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n!.startsWith("ring."))).toBe(true);
  });

  it("clicking a cell selects it and writes the URL hash", async () => {
    await mount();
    await act(async () => cellButton("square.1")!.click());
    expect(gridcellOf("square.1")!.getAttribute("aria-selected")).toBe("true");
    expect(new URLSearchParams(location.hash.slice(1)).get("selected")).toBe("square.1");
    expect(container.querySelector("aside")!.textContent).toContain("square.1");
  });

  it("arrow keys move the selection by one and by a row of columns", async () => {
    await mount();
    await act(async () => cellButton("square.1")!.click());
    await act(async () => key(cellButton("square.1")!, "ArrowRight"));
    expect(gridcellOf("square.2")!.getAttribute("aria-selected")).toBe("true");
    expect(gridcellOf("square.1")!.getAttribute("aria-selected")).toBe("false");
    const cols = Number(container.querySelector('[role="grid"]')!.getAttribute("aria-colcount"));
    expect(cols).toBeGreaterThan(1);
    await act(async () => key(cellButton("square.2")!, "ArrowDown"));
    expect(gridcellOf(nameAt(2 + cols))!.getAttribute("aria-selected")).toBe("true");
    await act(async () => key(cellButton(nameAt(2 + cols))!, "Home"));
    expect(gridcellOf("ring.0")!.getAttribute("aria-selected")).toBe("true");
  });

  it("reads query and selection back from the hash", async () => {
    history.replaceState(null, "", "/#q=ring&selected=ring.20");
    await mount();
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("ring");
    expect(status()).toContain("100");
    expect(gridcellOf("ring.20")!.getAttribute("aria-selected")).toBe("true");
  });

  it("the theme toggle sets data-theme on <html>", async () => {
    await mount();
    const toggle = container.querySelector<HTMLButtonElement>('button[data-control="theme"]')!;
    const seen = new Set<string | null>();
    for (let i = 0; i < 3; i++) {
      await act(async () => toggle.click());
      seen.add(document.documentElement.getAttribute("data-theme"));
    }
    expect(seen).toEqual(new Set(["light", "dark", "system"]));
  });

  it("a failed chunk shows a retry button that calls retry(chunk)", async () => {
    const fail = new Set([0]);
    const cache = await mount({ fail });
    const retry = vi.spyOn(cache, "retry");
    await waitFor(() => container.querySelector('button[data-control="retry"]') !== null);
    fail.clear();
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-control="retry"]')!.click());
    expect(retry).toHaveBeenCalledWith(0);
  });

  it("pins the rendered chunks: results spanning more chunks than the LRU holds load once each", async () => {
    // one "spark" symbol per chunk, 30 chunks, cache capacity 24
    const sparse = makeIndex(30 * PER_CHUNK, (i) => (i % PER_CHUNK === 0 ? `spark.${i}` : nameAt(i)));
    history.replaceState(null, "", "/#q=spark");
    const log: string[] = [];
    await mount({ index: sparse, capacity: 24, log });
    expect(cells()).toHaveLength(30);
    await waitFor(() => container.querySelectorAll('[role="gridcell"] svg').length === 30);
    const settled = log.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(settled).toBe(30);
    expect(log).toHaveLength(30);
    expect(new Set(log).size).toBe(30);
  });

  it("a deep-linked selection scrolls to its row with the real column count", async () => {
    viewWidth = 900; // 12 columns of 64 px
    const big = makeIndex(2000);
    const target = nameAt(1500); // row 125 (0-based) at 12 columns
    history.replaceState(null, "", `/#selected=${target}`);
    await mount({ index: big });
    const grid = container.querySelector('[role="grid"]')!;
    expect(grid.getAttribute("aria-colcount")).toBe("12");
    expect(gridcellOf(target)!.getAttribute("aria-selected")).toBe("true");
    expect(gridcellOf(target)!.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("126");
    // scrolled there: neighbouring rows are rendered, the top of the grid is not
    await waitFor(() => grid.querySelector('[role="row"][aria-rowindex="124"]') !== null);
    expect(grid.querySelector('[role="row"][aria-rowindex="1"]')).toBeNull();
  });

  it("the selected cell stays rendered and tabbable when it scrolls out of view", async () => {
    await mount();
    await act(async () => cellButton("square.1")!.click());
    cellButton("square.1")!.focus();
    const viewport = container.querySelector<HTMLElement>(".viewport")!;
    await act(async () => {
      viewport.scrollTop = 6000;
      viewport.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => container.querySelector('[role="row"][aria-rowindex="70"]') !== null);
    const button = cellButton("square.1");
    expect(button).not.toBeNull();
    expect(button!.tabIndex).toBe(0);
    expect(document.activeElement).toBe(button);
    expect(button!.getAttribute("aria-current")).toBe("true");
  });

  it("shows an error panel when index.json cannot load", async () => {
    const failing = (async () => json(null, 404)) as unknown as typeof fetch;
    await act(async () => {
      root.render(<App base="/pkg" fetchFn={failing} />);
    });
    await waitFor(() => container.querySelector('[role="alert"]') !== null);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("HTTP 404");
  });
});
