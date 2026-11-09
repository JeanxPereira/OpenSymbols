import { useEffect, useReducer, useState } from "react";
import type { RenderingMode, WeightName } from "@opensymbols/core";

export type Theme = "light" | "dark" | "system";
export type View = "grid" | "list";

export interface DemoState {
  query: string;
  category?: string;
  view: View;
  cellSize: number;
  gridWeight: WeightName;
  gridMode: RenderingMode;
  theme: Theme;
  /** A symbol name. */
  selected?: string;
}

export const WEIGHTS: readonly WeightName[] = [
  "ultralight",
  "thin",
  "light",
  "regular",
  "medium",
  "semibold",
  "bold",
  "heavy",
  "black",
];
export const MODES: readonly RenderingMode[] = ["monochrome", "hierarchical", "multicolor", "palette"];
export const THEMES: readonly Theme[] = ["system", "light", "dark"];
export const CELL_MIN = 32;
export const CELL_MAX = 96;

export type DemoAction =
  | { type: "query"; query: string }
  | { type: "category"; category?: string }
  | { type: "view"; view: View }
  | { type: "cellSize"; cellSize: number }
  | { type: "weight"; weight: WeightName }
  | { type: "mode"; mode: RenderingMode }
  | { type: "theme"; theme: Theme }
  | { type: "select"; selected?: string }
  /** The URL hash changed: replace the mirrored fields. */
  | { type: "hash"; fields: HashFields };

export type HashFields = Pick<DemoState, "query" | "category" | "selected">;

const THEME_KEY = "opensymbols-demo-theme";

export const initialState: DemoState = {
  query: "",
  view: "grid",
  cellSize: 64,
  gridWeight: "regular",
  gridMode: "monochrome",
  theme: "system",
};

const clamp = (n: number) => Math.min(CELL_MAX, Math.max(CELL_MIN, Math.round(n)));

/** Drops undefined/empty optional fields so states compare and serialise the same way. */
function tidy(s: DemoState): DemoState {
  const out = { ...s };
  if (!out.category || out.category === "all") delete out.category;
  if (!out.selected) delete out.selected;
  return out;
}

export function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "query":
      return state.query === action.query ? state : { ...state, query: action.query };
    case "category":
      return tidy({ ...state, category: action.category });
    case "view":
      return { ...state, view: action.view };
    case "cellSize":
      return { ...state, cellSize: clamp(action.cellSize) };
    case "weight":
      return { ...state, gridWeight: action.weight };
    case "mode":
      return { ...state, gridMode: action.mode };
    case "theme":
      return { ...state, theme: action.theme };
    case "select":
      return state.selected === action.selected ? state : tidy({ ...state, selected: action.selected });
    case "hash": {
      const f = action.fields;
      if (state.query === f.query && state.category === f.category && state.selected === f.selected) return state;
      return tidy({ ...state, query: f.query, category: f.category, selected: f.selected });
    }
  }
}

/** `#q=…&category=…&selected=…` → fields. */
export function readHash(hash: string): HashFields {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const fields: HashFields = { query: p.get("q") ?? "" };
  const category = p.get("category");
  const selected = p.get("selected");
  if (category && category !== "all") fields.category = category;
  if (selected) fields.selected = selected;
  return fields;
}

export function writeHash(f: HashFields): string {
  const p = new URLSearchParams();
  if (f.query) p.set("q", f.query);
  if (f.category) p.set("category", f.category);
  if (f.selected) p.set("selected", f.selected);
  const s = p.toString();
  return s ? `#${s}` : "";
}

/** The theme saved by a previous visit, or "system". */
export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    // storage unavailable: fall through
  }
  return "system";
}

function init(): DemoState {
  const hash = typeof location === "undefined" ? "" : location.hash;
  return tidy({ ...initialState, ...readHash(hash), theme: storedTheme() });
}

/**
 * The demo's state. `query`, `category` and `selected` mirror to `location.hash` (replaced, so typing
 * does not fill the history) and are read back on `hashchange`; the theme is applied as
 * `data-theme` on `<html>` and remembered per browser.
 */
export function useDemoState(): [DemoState, (a: DemoAction) => void] {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  useEffect(() => {
    const onHash = () => dispatch({ type: "hash", fields: readHash(location.hash) });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const { query, category, selected } = state;
  useEffect(() => {
    const next = writeHash({ query, category, selected });
    if (next === location.hash || (next === "" && location.hash === "")) return;
    history.replaceState(history.state, "", `${location.pathname}${location.search}${next}`);
  }, [query, category, selected]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  }, [state.theme]);

  return [state, dispatch];
}

function darkQuery(): MediaQueryList | undefined {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;
}

/** The appearance the theme resolves to now, following the system setting for "system". */
export function useAppearance(theme: Theme): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}
