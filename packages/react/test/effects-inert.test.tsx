// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIcon, type SymbolHandle } from "../src/index.js";
import { layer, symbol } from "./fixture.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Icon = createIcon(symbol("two", [layer([0, 2]), layer([2, 5])]));
const pkg = join(__dirname, "..");

let host: HTMLElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
});

describe("effect props without @opensymbols/animate/react", () => {
  it("static markup is the per-layer structure, with no effect attributes", () => {
    const html = renderToStaticMarkup(<Icon effect={{ kind: "bounce", direction: "up" }} trigger={1} active visible={false} />);
    expect(html).toContain('<g data-layer="0"><path d="M0 0L1 1"');
    expect(html).toContain('<g data-layer="1"><path d="M0 0L2 2Z"');
    for (const a of ["effect", "trigger", "active", "visible", "effectRef", "effectref"]) expect(html).not.toContain(` ${a}=`);
    expect(html).not.toContain("visibility");
  });

  it("an effect prop does nothing: no frame requested, no layer written, no handle", async () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const handle = createRef<SymbolHandle>();
    host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Icon effect={{ kind: "bounce" }} trigger={1} effectRef={handle} />));
    await act(async () => root.render(<Icon effect={{ kind: "bounce" }} trigger={2} effectRef={handle} />));
    expect(raf).not.toHaveBeenCalled();
    for (const g of host.querySelectorAll("[data-layer]")) expect(g.getAttribute("transform")).toBeNull();
    expect(handle.current).toBeNull();
    await act(async () => root.unmount());
  });

  it("the package never imports the engine", () => {
    const json = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const k of ["dependencies", "peerDependencies", "optionalDependencies"]) expect(Object.keys(json[k] ?? {})).not.toContain("@opensymbols/animate");
    for (const f of readdirSync(join(pkg, "src"))) expect(readFileSync(join(pkg, "src", f), "utf8")).not.toMatch(/^\s*(import|export)\b[^\n]*["']@opensymbols\/animate|import\(\s*["']@opensymbols\/animate/m);
  });
});
