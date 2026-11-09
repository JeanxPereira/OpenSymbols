import { useCallback, useEffect, useMemo, useState } from "react";
import { buildSvg, type RenderingMode, type SymbolData, type WeightName } from "@opensymbols/core";
import { SymbolIcon, type IconProps } from "@opensymbols/react";
import { symbolAt, type ChunkCache } from "../data/chunks.js";
import type { DemoIndex } from "../data/index-model.js";
import { ApproximationNotice } from "./ApproximationNotice.js";
import { Controls, DEFAULT_PALETTE, type InspectorSettings } from "./Controls.js";
import { CopyButtons } from "./CopyButtons.js";
import { useCacheVersion } from "./virtual.js";

/** Above every grid request (those are 0 at the viewport centre and negative further out). */
const INSPECTOR_PRIORITY = 1000;
const TEXT_COLOR = { light: "#1d1d1f", dark: "#f2f2f4" } as const;
const noop = () => {};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface InspectorProps {
  index: DemoIndex;
  cache: ChunkCache;
  /** The selected symbol's name. */
  name: string;
  /** The grid's weight and mode: the inspector starts from them. */
  gridWeight: WeightName;
  gridMode: RenderingMode;
  /** The page's resolved theme. */
  appearance: "light" | "dark";
}

/** "dark" and "RTL" when the symbol stores those variants. */
export function variantsOf(data: SymbolData): string[] {
  const keys = Object.keys(data.variants);
  const out: string[] = [];
  if (keys.some((k) => /^a1d/.test(k))) out.push("Dark");
  if (keys.some((k) => /d5$/.test(k))) out.push("Right to left");
  return out;
}

/**
 * The selected symbol: a large preview, its rendering controls, why the render is approximate,
 * its info and copy buttons. Control values are kept across selections, so symbols can be compared
 * at the same settings; the variable value is dropped for a symbol without thresholds.
 */
export function Inspector({ index, cache, name, gridWeight, gridMode, appearance }: InspectorProps) {
  const [settings, setSettings] = useState<InspectorSettings>(() => ({
    mode: gridMode,
    weight: gridWeight,
    size: 128,
    palette: DEFAULT_PALETTE,
    appearance: "theme",
    layout: "box",
    direction: "auto",
  }));
  const onChange = useCallback((patch: Partial<InspectorSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const pos = useMemo(() => index.symbols.findIndex((s) => s.name === name), [index, name]);
  const sym = index.symbols[pos];
  const chunk = sym?.chunk;
  const version = useCacheVersion(cache);

  useEffect(() => {
    if (sym && !sym.variableValue) setSettings((s) => (s.variableValue === undefined ? s : { ...s, variableValue: undefined }));
  }, [sym]);

  // The preview's chunk is pinned under its own owner, so the grid's pin and prune never drop it.
  useEffect(() => {
    if (chunk === undefined) return;
    cache.pin("inspector", new Set([chunk]));
  }, [cache, chunk]);
  useEffect(() => () => cache.pin("inspector", new Set()), [cache]);
  useEffect(() => {
    if (chunk === undefined || cache.get(chunk) || cache.error(chunk)) return;
    cache.load(chunk, INSPECTOR_PRIORITY).catch(noop); // failures surface via error()
  }, [cache, chunk, version]);

  const data = pos >= 0 ? symbolAt(cache, index, pos) : undefined;
  const failed = chunk !== undefined && cache.error(chunk) !== undefined;
  const resolved = settings.appearance === "theme" ? appearance : settings.appearance;

  const palette = settings.mode === "palette" ? settings.palette : undefined;
  const variableValue = sym?.variableValue ? settings.variableValue : undefined;
  const iconProps: IconProps = {
    size: settings.size,
    weight: settings.weight,
    mode: settings.mode,
    appearance: resolved,
    layout: settings.layout,
    direction: settings.direction,
    ...(settings.color !== undefined ? { color: settings.color } : {}),
    ...(palette !== undefined ? { palette } : {}),
    ...(variableValue !== undefined ? { variableValue } : {}),
  };

  // The same build the preview renders, so the notice lists exactly its `data-approximations`.
  const reasons = useMemo(() => {
    if (!data) return [];
    return buildSvg(data, {
      mode: settings.mode,
      color: settings.color ?? "currentColor",
      appearance: resolved,
      size: settings.size,
      weight: settings.weight,
      layout: settings.layout,
      // "auto" renders left to right until a `dir` ancestor says otherwise; the stage has none.
      direction: settings.direction === "rtl" ? "rtl" : "ltr",
      idPrefix: "os",
      ...(palette !== undefined ? { palette } : {}),
      ...(variableValue !== undefined ? { variableValue } : {}),
    }).approximations;
  }, [data, settings, resolved, palette, variableValue]);

  if (!sym) {
    return (
      <div className="inspector">
        <h2 className="inspector-name">{name}</h2>
        <p className="panel-quiet">This package has no symbol of that name.</p>
      </div>
    );
  }

  const categories = sym.categories.map((k) => index.categories.find((c) => c.key === k)?.label ?? k);

  return (
    <div className="inspector">
      <header className="inspector-header">
        <h2 className="inspector-name">{sym.name}</h2>
      </header>

      <div className="inspector-stage" data-appearance={resolved} aria-busy={!data && !failed ? true : undefined}>
        {data ? (
          <SymbolIcon data={data} {...iconProps} title={sym.name} />
        ) : failed ? (
          <div className="stage-error">
            <p>The symbol could not be loaded.</p>
            <button type="button" className="button" onClick={() => cache.retry(chunk!)}>
              Retry
            </button>
          </div>
        ) : (
          <span className="stage-placeholder" aria-label="Loading" />
        )}
      </div>

      <ApproximationNotice reasons={reasons} />

      <Controls
        settings={settings}
        onChange={onChange}
        modes={sym.modes}
        variableValue={sym.variableValue}
        textColor={TEXT_COLOR[appearance]}
      />

      <dl className="inspector-info">
        <dt>Component</dt>
        <dd>
          <code>{sym.component}</code>
        </dd>
        {sym.aliases.length > 0 && (
          <>
            <dt>Aliases</dt>
            <dd>{sym.aliases.join(", ")}</dd>
          </>
        )}
        <dt>Year</dt>
        <dd>{sym.year ?? "Unknown"}</dd>
        <dt>Categories</dt>
        <dd>{categories.length > 0 ? categories.join(", ") : "None"}</dd>
        <dt>Modes</dt>
        <dd>{sym.modes.map(cap).join(", ")}</dd>
        <dt>Variants</dt>
        <dd>{data ? variantsOf(data).join(", ") || "None" : "…"}</dd>
      </dl>

      <CopyButtons pkg={index.package.name} component={sym.component} data={data} props={iconProps} />
    </div>
  );
}
