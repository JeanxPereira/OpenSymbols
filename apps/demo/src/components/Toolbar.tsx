import { useEffect, useRef, useState } from "react";
import type { RenderingMode, WeightName } from "@opensymbols/core";
import { CELL_MAX, CELL_MIN, MODES, THEMES, WEIGHTS, type DemoAction, type DemoState } from "../state.js";

const DEBOUNCE_MS = 80;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface ToolbarProps {
  state: DemoState;
  dispatch: (a: DemoAction) => void;
}

export function Toolbar({ state, dispatch }: ToolbarProps) {
  const [text, setText] = useState(state.query);
  const sent = useRef(state.query);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A query changed from outside (the URL hash) replaces the field's text.
  useEffect(() => {
    if (state.query !== sent.current) {
      sent.current = state.query;
      setText(state.query);
    }
  }, [state.query]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onText = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      sent.current = value;
      dispatch({ type: "query", query: value });
    }, DEBOUNCE_MS);
  };

  const nextTheme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length] ?? "system";

  return (
    <div className="toolbar">
      <input
        type="search"
        className="search"
        placeholder="Search symbols"
        aria-label="Search symbols"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            onText("");
          }
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="segmented" role="group" aria-label="View">
        {(["grid", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={state.view === v}
            onClick={() => dispatch({ type: "view", view: v })}
          >
            {cap(v)}
          </button>
        ))}
      </div>
      <label className="control">
        <span className="control-label">Size</span>
        <input
          type="range"
          min={CELL_MIN}
          max={CELL_MAX}
          step={4}
          value={state.cellSize}
          disabled={state.view !== "grid"}
          aria-valuetext={`${state.cellSize} pixels`}
          onChange={(e) => dispatch({ type: "cellSize", cellSize: Number(e.target.value) })}
        />
      </label>
      <label className="control">
        <span className="control-label">Weight</span>
        <select
          value={state.gridWeight}
          onChange={(e) => dispatch({ type: "weight", weight: e.target.value as WeightName })}
        >
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {cap(w)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span className="control-label">Mode</span>
        <select value={state.gridMode} onChange={(e) => dispatch({ type: "mode", mode: e.target.value as RenderingMode })}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {cap(m)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="theme-toggle"
        data-control="theme"
        title={`Theme: ${cap(state.theme)}. Switch to ${cap(nextTheme)}`}
        onClick={() => dispatch({ type: "theme", theme: nextTheme })}
      >
        <span className="control-label">Theme</span> {cap(state.theme)}
      </button>
    </div>
  );
}
