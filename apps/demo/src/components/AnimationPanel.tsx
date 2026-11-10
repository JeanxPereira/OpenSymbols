// Loaded with the inspector chunk only: importing the animate entry registers the effects driver,
// so the grid's first paint never carries the engine.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SymbolData } from "@opensymbols/core";
import { createIcon, SymbolIcon, type EffectProps, type IconProps, type SymbolHandle } from "@opensymbols/react";
import { duration, loopStart, sample, type AnimDrawing, type Spec } from "@opensymbols/animate";
import { drawingOf, renderFrame, Replace, toSpec, type ReplaceProps } from "@opensymbols/animate/react";
import { symbolAt, type ChunkCache } from "../data/chunks.js";
import type { DemoIndex } from "../data/index-model.js";
import { search } from "../data/search.js";
import { buildEffect, EFFECT_OPTIONS, isStill, OPTION_META, optionApplies, PANEL_KINDS, REPEATS, SPEED_DEFAULT, type OptionKey, type OptionValues, type PanelKind } from "../effects.js";

const INSPECTOR_PRIORITY = 1000;
const noop = () => {};
const RESULTS_MAX = 6;

export type ReplaceStyle = NonNullable<ReplaceProps["style"]>;

/** The panel's settings (kept across selections, like the rendering controls). */
export interface AnimationSettings {
  kind: "none" | PanelKind | "replace";
  /** Option values by name, shared by the kinds that take the option. */
  values: OptionValues;
  speed: number;
  repeat: "once" | "continuous";
  /** Replace: the second symbol's name. */
  target?: string;
  replaceStyle: ReplaceStyle;
  magic: boolean;
}

export const DEFAULT_ANIMATION: AnimationSettings = { kind: "none", values: {}, speed: SPEED_DEFAULT, repeat: "once", replaceStyle: "downUp", magic: false };

/**
 * What the preview should do. `play` and `stop` count presses (a change is a press); `scrub` is the
 * timeline position in seconds, or null when the effect plays live.
 */
export interface Transport {
  play: number;
  stop: number;
  scrub: number | null;
}

export const IDLE: Transport = { play: 0, stop: 0, scrub: null };

const KIND_LABELS: Record<AnimationSettings["kind"], string> = {
  none: "None",
  appear: "Appear",
  disappear: "Disappear",
  bounce: "Bounce",
  pulse: "Pulse",
  breathe: "Breathe",
  wiggle: "Wiggle",
  rotate: "Rotate",
  scale: "Scale",
  draw: "Draw",
  variableColor: "Variable Color",
  replace: "Replace",
};

const STYLE_LABELS: ReadonlyArray<readonly [ReplaceStyle, string]> = [
  ["downUp", "Down, up"],
  ["upUp", "Up, up"],
  ["offUp", "Off, up"],
  ["plain", "Plain"],
];

/** The icon effect the settings describe; undefined for none and for Replace. */
export function effectFor(s: AnimationSettings): EffectProps | undefined {
  if (s.kind === "none" || s.kind === "replace") return undefined;
  return buildEffect(s.kind, s.values, s.speed, s.repeat);
}

/** The drawing and spec the driver would use for `effect` on this icon, and the timeline's length. */
export interface FrameModel {
  drawing: AnimDrawing;
  spec: Spec;
  /**
   * Seconds the timeline spans: one run of a once effect; for a continuous one, the intro and one
   * loop period after it (`loopStart() + duration()`, 07 §6.3), so the loop itself can be scrubbed.
   */
  duration: number;
}

export function frameModel(data: SymbolData, props: IconProps, effect: EffectProps): FrameModel {
  const appearance = props.appearance ?? "light";
  const mode = props.mode && data.modes.includes(props.mode) ? props.mode : "monochrome";
  const drawing = drawingOf({ data, weight: props.weight ?? "regular", appearance, direction: props.direction === "rtl" ? "rtl" : "ltr" });
  // The selected repeat: a continuous effect's timeline is its loop, not its once form.
  const repeat = "repeat" in effect && effect.repeat === "continuous" ? "continuous" : "once";
  const spec = toSpec(effect, { mode, appearance }, repeat);
  return { drawing, spec, duration: loopStart(drawing, spec) + duration(drawing, spec) };
}

/** The Replace target's data: its chunk pinned under the owner "replace" and loaded on demand. */
export function useReplaceTarget(cache: ChunkCache, index: DemoIndex, name: string | undefined, version: number): SymbolData | undefined {
  const pos = useMemo(() => (name === undefined ? -1 : index.symbols.findIndex((s) => s.name === name)), [index, name]);
  const chunk = index.symbols[pos]?.chunk;
  useEffect(() => {
    cache.pin("replace", chunk === undefined ? new Set() : new Set([chunk]));
  }, [cache, chunk]);
  useEffect(() => () => cache.pin("replace", new Set()), [cache]);
  useEffect(() => {
    if (chunk === undefined || cache.get(chunk) || cache.error(chunk)) return;
    cache.load(chunk, INSPECTOR_PRIORITY).catch(noop);
  }, [cache, chunk, version]);
  return pos >= 0 ? symbolAt(cache, index, pos) : undefined;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---- the stage ----

export interface AnimatedPreviewProps {
  data: SymbolData;
  iconProps: IconProps;
  title: string;
  settings: AnimationSettings;
  transport: Transport;
  /** For an icon effect: the scrubber's frame model. */
  model: FrameModel | undefined;
  /** For Replace: the second symbol, once loaded. */
  target: SymbolData | undefined;
}

/** The inspector stage's icon: plain, playing an effect, scrubbed to a time, or a Replace. */
export function AnimatedPreview(props: AnimatedPreviewProps) {
  const { data, iconProps, title, settings, transport, target } = props;
  if (settings.kind === "replace" && target) {
    return <ReplacePreview from={data} to={target} iconProps={iconProps} title={title} settings={settings} play={transport.play} />;
  }
  return <EffectPreview {...props} effect={effectFor(settings)} />;
}

function ReplacePreview({ from, to, iconProps, title, settings, play }: { from: SymbolData; to: SymbolData; iconProps: IconProps; title: string; settings: AnimationSettings; play: number }) {
  const From = useMemo(() => createIcon(from), [from]);
  const To = useMemo(() => createIcon(to), [to]);
  // Each press of Play swaps to the other symbol.
  const show = play % 2 === 1 ? "to" : "from";
  return (
    <Replace
      {...iconProps}
      from={From}
      to={To}
      show={show}
      style={settings.replaceStyle}
      magic={settings.magic}
      speed={settings.speed}
      title={show === "to" ? to.name : title}
    />
  );
}

function EffectPreview({ data, iconProps, title, transport, model, effect }: AnimatedPreviewProps & { effect: EffectProps | undefined }) {
  const handle = useRef<SymbolHandle>(null);
  const svg = useRef<SVGSVGElement>(null);
  // Bumped by Stop on a once effect: a fresh icon is the static symbol again.
  const [epoch, setEpoch] = useState(0);
  const scrub = effect && model && transport.scrub !== null ? Math.min(transport.scrub, model.duration) : null;
  const seen = useRef({ play: transport.play, stop: transport.stop });
  const effectKey = effect ? JSON.stringify(effect) : "";

  useEffect(() => {
    if (transport.play === seen.current.play) return;
    seen.current.play = transport.play;
    if (effect) handle.current?.play(effect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport.play]);

  useEffect(() => {
    if (transport.stop === seen.current.stop) return;
    seen.current.stop = transport.stop;
    // A continuous effect finishes its cycle, then rests (07 §6.3); a once effect is cut.
    if (effect && "repeat" in effect && effect.repeat === "continuous") handle.current?.stop();
    else setEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport.stop]);

  // Scrubbing: the icon is mounted without its effect (the driver has nothing to run on it) and the
  // frame at `scrub` is written through the driver's own write path, after every render.
  useLayoutEffect(() => {
    if (scrub === null || !model || !svg.current) return;
    renderFrame(svg.current, model.drawing, sample(model.drawing, model.spec, scrub));
  });

  // A new key remounts the icon: entering the scrubber stops a running effect, and an option change
  // starts from the static symbol.
  const key = scrub !== null ? "scrub" : `live-${epoch}-${effectKey}`;
  const live = scrub === null && effect ? { effect, effectRef: handle } : {};
  return <SymbolIcon key={key} ref={svg} data={data} {...iconProps} {...live} title={title} />;
}

// ---- the panel ----

export interface AnimationPanelProps {
  index: DemoIndex;
  /** The selected symbol (Replace never offers it as its own target). */
  name: string;
  settings: AnimationSettings;
  onChange: (patch: Partial<AnimationSettings>) => void;
  transport: Transport;
  onTransport: (t: Transport) => void;
  /** The current icon effect's run length (seconds), for the timeline. */
  duration: number | undefined;
}

const fmtSeconds = (s: number) => `${s.toFixed(2)} s`;

/**
 * The effect picker with exactly the options the chosen effect takes (`EFFECT_OPTIONS`), speed,
 * once or continuous where the effect has a continuous form, Play and Stop, and a timeline that
 * pauses playback and shows the frame at a time. Replace picks a second symbol, a style and Magic.
 */
export function AnimationPanel({ index, name, settings, onChange, transport, onTransport, duration: length }: AnimationPanelProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const kind = settings.kind;
  const isEffect = kind !== "none" && kind !== "replace";
  const results = useMemo(() => {
    if (kind !== "replace" || query.trim() === "") return [];
    return search(index, query)
      .map((i) => index.symbols[i]!.name)
      .filter((n) => n !== name)
      .slice(0, RESULTS_MAX);
  }, [index, query, kind, name]);

  const setValue = (key: OptionKey, value: string | boolean | number | undefined) => onChange({ values: { ...settings.values, [key]: value } });
  const reduced = useMemo(prefersReducedMotion, []);
  const canPlay = isEffect || (kind === "replace" && settings.target !== undefined);
  const canStop = isEffect;
  // Variable Color at a value: a still frame, with no speed or repeat.
  const still = isEffect && isStill(kind, settings.values);

  return (
    <section className="animation" aria-label="Animation">
      <h3 className="section-title">Animation</h3>
      <div className="controls">
        <label className="field-label" htmlFor={`${id}-effect`}>
          Effect
        </label>
        <select
          id={`${id}-effect`}
          data-control="effect"
          value={kind}
          onChange={(e) => {
            onChange({ kind: e.target.value as AnimationSettings["kind"] });
            onTransport({ ...transport, scrub: null });
          }}
        >
          {(["none", ...PANEL_KINDS, "replace"] as const).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>

        {isEffect &&
          (EFFECT_OPTIONS[kind] as readonly OptionKey[]).map((key) => {
            const meta = OPTION_META[key];
            const fid = `${id}-${key}`;
            const applies = optionApplies(kind, key, settings.values);
            // Reverse order shows disabled outside Draw Off; Variable Color's animated options are hidden at a value.
            if (!applies && key !== "drawReversedOrder") return null;
            if (meta.type === "value") {
              const v = settings.values[key];
              const set = typeof v === "number";
              return (
                <OptionRow key={key} label={meta.label} htmlFor={fid}>
                  <select id={fid} data-option={key} value={set ? "set" : ""} onChange={(e) => setValue(key, e.target.value === "set" ? meta.initial : undefined)}>
                    <option value="">{meta.unset}</option>
                    <option value="set">{meta.set}</option>
                  </select>
                  {set && (
                    <>
                      <input
                        type="range"
                        data-control="effect-value"
                        aria-label={meta.set}
                        min={0}
                        max={1}
                        step={0.01}
                        value={v}
                        onChange={(e) => setValue(key, Number(e.target.value))}
                      />
                      <output className="field-value">{`${Math.round(v * 100)}%`}</output>
                    </>
                  )}
                </OptionRow>
              );
            }
            if (meta.type === "choice") {
              return (
                <OptionRow key={key} label={meta.label} htmlFor={fid}>
                  <select id={fid} data-option={key} value={String(settings.values[key] ?? "")} onChange={(e) => setValue(key, e.target.value)}>
                    {meta.values.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </OptionRow>
              );
            }
            const checked = typeof settings.values[key] === "boolean" ? (settings.values[key] as boolean) : meta.default;
            return (
              <OptionRow key={key} label={meta.label} htmlFor={fid}>
                <input id={fid} type="checkbox" data-option={key} checked={checked} disabled={!applies} onChange={(e) => setValue(key, e.target.checked)} />
              </OptionRow>
            );
          })}

        {kind === "replace" && (
          <>
            <label className="field-label" htmlFor={`${id}-search`}>
              With
            </label>
            <div className="field-stack">
              <input
                id={`${id}-search`}
                type="search"
                className="field-input"
                data-control="replace-search"
                placeholder={settings.target ?? "Search symbols"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <ul className="replace-results" aria-label="Matching symbols">
                  {results.map((n) => (
                    <li key={n}>
                      <button
                        type="button"
                        className="replace-result"
                        data-replace-target={n}
                        aria-pressed={settings.target === n}
                        onClick={() => {
                          onChange({ target: n });
                          setQuery("");
                        }}
                      >
                        {n}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {settings.target !== undefined && results.length === 0 && <span className="field-value">Replace with {settings.target}</span>}
            </div>

            <label className="field-label" htmlFor={`${id}-style`}>
              Style
            </label>
            <select id={`${id}-style`} data-control="replace-style" value={settings.replaceStyle} onChange={(e) => onChange({ replaceStyle: e.target.value as ReplaceStyle })}>
              {STYLE_LABELS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor={`${id}-magic`}>
              Magic
            </label>
            <div className="field-row">
              <input id={`${id}-magic`} type="checkbox" data-control="replace-magic" checked={settings.magic} onChange={(e) => onChange({ magic: e.target.checked })} />
              <span className="field-value">Slash and badge changes in place</span>
            </div>
          </>
        )}

        {kind !== "none" && !still && (
          <>
            <label className="field-label" htmlFor={`${id}-speed`}>
              Speed
            </label>
            <div className="field-row">
              <input
                id={`${id}-speed`}
                type="range"
                data-control="speed"
                min={0.25}
                max={4}
                step={0.25}
                value={settings.speed}
                aria-valuetext={`${settings.speed} times`}
                onChange={(e) => onChange({ speed: Number(e.target.value) })}
              />
              <output className="field-value" htmlFor={`${id}-speed`}>
                {settings.speed}×
              </output>
            </div>
          </>
        )}

        {isEffect && REPEATS[kind] && !still && (
          <>
            <label className="field-label" htmlFor={`${id}-repeat`}>
              Repeat
            </label>
            <select id={`${id}-repeat`} data-control="repeat" value={settings.repeat} onChange={(e) => onChange({ repeat: e.target.value as AnimationSettings["repeat"] })}>
              <option value="once">Once</option>
              <option value="continuous">Continuous</option>
            </select>
          </>
        )}
      </div>

      {kind !== "none" && (
        <div className="transport">
          <button type="button" className="button button-primary" data-control="play" disabled={!canPlay} onClick={() => onTransport({ ...transport, play: transport.play + 1, scrub: null })}>
            {kind === "replace" ? "Swap" : "Play"}
          </button>
          <button type="button" className="button" data-control="stop" disabled={!canStop} onClick={() => onTransport({ ...transport, stop: transport.stop + 1, scrub: null })}>
            Stop
          </button>
        </div>
      )}

      {isEffect && length !== undefined && (
        <div className="timeline">
          <label className="field-label" htmlFor={`${id}-scrub`}>
            Timeline
          </label>
          <input
            id={`${id}-scrub`}
            type="range"
            data-control="scrub"
            min={0}
            max={length}
            step="any"
            value={Math.min(transport.scrub ?? 0, length)}
            aria-valuetext={fmtSeconds(Math.min(transport.scrub ?? 0, length))}
            onChange={(e) => onTransport({ ...transport, scrub: Number(e.target.value) })}
          />
          <output className="field-value" htmlFor={`${id}-scrub`}>
            {transport.scrub === null ? `Live · ${fmtSeconds(length)}` : `${fmtSeconds(Math.min(transport.scrub, length))} / ${fmtSeconds(length)}`}
          </output>
        </div>
      )}

      {kind !== "none" && reduced && <p className="panel-note">Reduce motion is on: effects jump to their end state.</p>}
    </section>
  );
}

function OptionRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="field-row">{children}</div>
    </>
  );
}
