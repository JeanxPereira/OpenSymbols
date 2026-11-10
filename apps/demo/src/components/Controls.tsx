import { useId } from "react";
import { weightValue, type RenderingMode, type RenderMode, type Weight } from "@opensymbols/core";
import { MODES, WEIGHTS } from "../state.js";

export const SIZE_MIN = 16;
export const SIZE_MAX = 256;

/** The inspector's rendering settings (local to the inspector, kept across selections). */
export interface InspectorSettings {
  mode: RenderingMode;
  weight: Weight;
  /** The symbol scale (SwiftUI's `imageScale`); default "medium". */
  scale: Scale;
  /** The requested locale; undefined: the base drawing. Kept across symbols, drawn where it resolves. */
  locale?: string;
  size: number;
  /** Undefined: `currentColor`. */
  color?: string;
  palette: [string, string, string];
  /** "theme" follows the page's light or dark theme. */
  appearance: "theme" | "light" | "dark";
  layout: "box" | "text";
  direction: "auto" | "ltr" | "rtl";
  /** Undefined: not applied. */
  variableValue?: number;
}

export type Scale = "small" | "medium" | "large";
export const SCALES: readonly Scale[] = ["small", "medium", "large"];

export const DEFAULT_PALETTE: [string, string, string] = ["#0a66d8", "#34a853", "#f29900"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A weight on the slider: whole steps are the named weights, anything between stays a number. */
export function weightFromSlider(n: number): Weight {
  return Number.isInteger(n) ? (WEIGHTS[n - 1] ?? n) : n;
}

export interface ControlsProps {
  settings: InspectorSettings;
  onChange: (patch: Partial<InspectorSettings>) => void;
  /** The modes the symbol offers; others are listed but marked. */
  modes: RenderMode[];
  /** The symbol has variable-value thresholds. */
  variableValue: boolean;
  /** The text colour the tint picker shows while the tint is `currentColor`. */
  textColor: string;
  /** The symbol's stored locale tags; no Locale control when empty. */
  locales: readonly string[];
  /** The stored tag `settings.locale` resolves to for this symbol, if any. */
  resolvedLocale: string | undefined;
}

export function Controls({ settings, onChange, modes, variableValue, textColor, locales, resolvedLocale }: ControlsProps) {
  const id = useId();
  const w = weightValue(settings.weight);
  const named = typeof settings.weight === "string" ? settings.weight : Number.isInteger(w) ? WEIGHTS[w - 1] : undefined;

  return (
    <div className="controls">
      <label className="field-label" htmlFor={`${id}-mode`}>
        Mode
      </label>
      <select
        id={`${id}-mode`}
        data-control="mode"
        value={settings.mode}
        onChange={(e) => onChange({ mode: e.target.value as RenderingMode })}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {modes.includes(m) ? cap(m) : `${cap(m)} (not in this symbol)`}
          </option>
        ))}
      </select>

      {settings.mode === "palette" && (
        <>
          <span className="field-label" id={`${id}-palette`}>
            Palette
          </span>
          <div className="field-row" role="group" aria-labelledby={`${id}-palette`}>
            {settings.palette.map((c, i) => (
              <input
                key={i}
                type="color"
                className="swatch"
                data-control={`palette-${i}`}
                aria-label={`Palette colour ${i + 1}`}
                value={c}
                onChange={(e) => {
                  const palette = [...settings.palette] as InspectorSettings["palette"];
                  palette[i] = e.target.value;
                  onChange({ palette });
                }}
              />
            ))}
          </div>
        </>
      )}

      <label className="field-label" htmlFor={`${id}-weight`}>
        Weight
      </label>
      <div className="field-stack">
        <select
          id={`${id}-weight`}
          data-control="weight"
          value={named ?? "custom"}
          onChange={(e) => onChange({ weight: e.target.value as Weight })}
        >
          {named === undefined && <option value="custom">{w.toFixed(1)}</option>}
          {WEIGHTS.map((name) => (
            <option key={name} value={name}>
              {cap(name)}
            </option>
          ))}
        </select>
        <input
          type="range"
          data-control="weight-value"
          aria-label="Weight, 1 to 9"
          min={1}
          max={9}
          step={0.1}
          value={w}
          aria-valuetext={named ? `${cap(named)} (${w})` : String(w)}
          onChange={(e) => onChange({ weight: weightFromSlider(Number(e.target.value)) })}
        />
      </div>

      <label className="field-label" htmlFor={`${id}-scale`}>
        Scale
      </label>
      <select
        id={`${id}-scale`}
        data-control="scale"
        value={settings.scale}
        onChange={(e) => onChange({ scale: e.target.value as Scale })}
      >
        {SCALES.map((s) => (
          <option key={s} value={s}>
            {cap(s)}
          </option>
        ))}
      </select>

      {locales.length > 0 && (
        <>
          <label className="field-label" htmlFor={`${id}-locale`}>
            Locale
          </label>
          <select
            id={`${id}-locale`}
            data-control="locale"
            value={resolvedLocale ?? ""}
            onChange={(e) => onChange({ locale: e.target.value === "" ? undefined : e.target.value })}
          >
            <option value="">Base</option>
            {locales.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </>
      )}

      <label className="field-label" htmlFor={`${id}-size`}>
        Size
      </label>
      <div className="field-row">
        <input
          id={`${id}-size`}
          type="range"
          data-control="size"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          value={settings.size}
          aria-valuetext={`${settings.size} pixels`}
          onChange={(e) => onChange({ size: Number(e.target.value) })}
        />
        <output className="field-value" htmlFor={`${id}-size`}>
          {settings.size} px
        </output>
      </div>

      <label className="field-label" htmlFor={`${id}-color`}>
        Tint
      </label>
      <div className="field-row">
        <input
          id={`${id}-color`}
          type="color"
          className="swatch"
          data-control="color"
          value={settings.color ?? textColor}
          onChange={(e) => onChange({ color: e.target.value })}
        />
        {settings.color === undefined ? (
          <span className="field-value">Text colour</span>
        ) : (
          <button type="button" className="link-button" onClick={() => onChange({ color: undefined })}>
            Use text colour
          </button>
        )}
      </div>

      <label className="field-label" htmlFor={`${id}-appearance`}>
        Appearance
      </label>
      <select
        id={`${id}-appearance`}
        data-control="appearance"
        value={settings.appearance}
        onChange={(e) => onChange({ appearance: e.target.value as InspectorSettings["appearance"] })}
      >
        <option value="theme">Match theme</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <label className="field-label" htmlFor={`${id}-layout`}>
        Layout
      </label>
      <select
        id={`${id}-layout`}
        data-control="layout"
        value={settings.layout}
        onChange={(e) => onChange({ layout: e.target.value as InspectorSettings["layout"] })}
      >
        <option value="box">Box</option>
        <option value="text">Text</option>
      </select>

      <label className="field-label" htmlFor={`${id}-direction`}>
        Direction
      </label>
      <select
        id={`${id}-direction`}
        data-control="direction"
        value={settings.direction}
        onChange={(e) => onChange({ direction: e.target.value as InspectorSettings["direction"] })}
      >
        <option value="auto">Auto</option>
        <option value="ltr">Left to right</option>
        <option value="rtl">Right to left</option>
      </select>

      {variableValue && (
        <>
          <span className="field-label" id={`${id}-value`}>
            Value
          </span>
          <div className="field-row" role="group" aria-labelledby={`${id}-value`}>
            <input
              type="checkbox"
              data-control="variable-value-on"
              aria-label="Apply a variable value"
              checked={settings.variableValue !== undefined}
              onChange={(e) => onChange({ variableValue: e.target.checked ? 1 : undefined })}
            />
            <input
              type="range"
              data-control="variable-value"
              aria-label="Variable value"
              min={0}
              max={1}
              step={0.01}
              value={settings.variableValue ?? 1}
              disabled={settings.variableValue === undefined}
              onChange={(e) => onChange({ variableValue: Number(e.target.value) })}
            />
            <output className="field-value">
              {settings.variableValue === undefined ? "Off" : `${Math.round(settings.variableValue * 100)}%`}
            </output>
          </div>
        </>
      )}
    </div>
  );
}
