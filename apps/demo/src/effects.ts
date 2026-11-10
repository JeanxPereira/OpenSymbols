import type { EffectProps } from "@opensymbols/react";

/** The effects the animation panel offers: every icon effect. Replace is its own component and its own mode of the panel. */
export type PanelKind = EffectProps["kind"];

/** The member of `EffectProps` that takes `kind: K` (Appear and Disappear share one). */
type EffectOf<K extends string> = EffectProps extends infer E ? (E extends { kind: infer KK } ? (K extends KK ? E : never) : never) : never;

/** Kind K's own options: everything but `kind`, and `speed` and `repeat`, which the panel shows for every kind. */
export type OptionOf<K extends PanelKind> = Exclude<keyof EffectOf<K>, "kind" | "speed" | "repeat">;
export type OptionKey = { [K in PanelKind]: OptionOf<K> }[PanelKind];

/** Each kind's options, in the order the panel lists them. Checked against `EffectProps` both ways below. */
export const EFFECT_OPTIONS = {
  appear: ["direction", "byLayer"],
  disappear: ["direction", "byLayer"],
  bounce: ["direction", "byLayer"],
  pulse: ["byLayer"],
  breathe: ["breathePlain", "byLayer"],
  wiggle: ["byLayer"],
  rotate: ["rotateDirection", "byLayer"],
  scale: ["direction", "byLayer"],
  draw: ["reversed", "drawIndividually", "drawReversedOrder", "byLayer"],
  variableColor: ["variableValue", "fill", "reversing", "inactive"],
} as const satisfies { [K in PanelKind]: ReadonlyArray<OptionOf<K>> };

/** Options a kind takes that change nothing for it, so the panel leaves them out: Variable Color has no motion groups (07 §9.5). */
const UNUSED = { variableColor: ["byLayer"] } as const satisfies { [K in PanelKind]?: ReadonlyArray<OptionOf<K>> };
type Unused<K extends PanelKind> = K extends keyof typeof UNUSED ? (typeof UNUSED)[K][number] : never;

// No option of `EffectProps` is left out of the table (a new option fails the typecheck here).
type Unlisted = { [K in PanelKind]: Exclude<OptionOf<K>, (typeof EFFECT_OPTIONS)[K][number] | Unused<K>> }[PanelKind];
const everyOptionListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyOptionListed;

/** Whether the kind has a continuous form (`repeat` in its props). */
export const REPEATS = {
  appear: false,
  disappear: false,
  bounce: true,
  pulse: true,
  breathe: true,
  wiggle: true,
  rotate: true,
  scale: false,
  draw: false,
  variableColor: true,
} as const satisfies { [K in PanelKind]: "repeat" extends keyof EffectOf<K> ? true : false };

export const PANEL_KINDS = Object.keys(EFFECT_OPTIONS) as PanelKind[];

export type OptionMeta =
  /** `default`: the value the effect takes when unset, which is then left out of the effect too. */
  | { type: "choice"; label: string; values: ReadonlyArray<readonly [value: string, label: string]>; default?: string }
  | { type: "toggle"; label: string; default: boolean }
  /** A number that is either unset (the first label) or set on a 0..1 slider (the second label; `initial` when first set). */
  | { type: "value"; label: string; unset: string; set: string; initial: number };

/** How the panel shows each option. A choice's first value is "unset" (the effect's default). */
export const OPTION_META: { [O in OptionKey]: OptionMeta } = {
  direction: {
    type: "choice",
    label: "Direction",
    values: [
      ["", "Default"],
      ["up", "Up"],
      ["down", "Down"],
    ],
  },
  rotateDirection: {
    type: "choice",
    label: "Rotation",
    values: [
      ["", "Symbol's own"],
      ["clockwise", "Clockwise"],
      ["counterClockwise", "Counter-clockwise"],
    ],
  },
  breathePlain: { type: "toggle", label: "Scale only", default: false },
  reversed: { type: "toggle", label: "Draw off", default: false },
  drawIndividually: { type: "toggle", label: "Individually", default: false },
  drawReversedOrder: { type: "toggle", label: "Reverse order", default: false },
  variableValue: { type: "value", label: "Form", unset: "Animated", set: "Value", initial: 1 },
  fill: {
    type: "choice",
    label: "Fill",
    default: "cumulative",
    values: [
      ["", "Cumulative"],
      ["iterative", "Iterative"],
    ],
  },
  reversing: { type: "toggle", label: "Reversing", default: false },
  inactive: {
    type: "choice",
    label: "Inactive layers",
    default: "dim",
    values: [
      ["", "Dim"],
      ["hide", "Hide"],
    ],
  },
  byLayer: { type: "toggle", label: "By layer", default: true },
};

export const SPEED_DEFAULT = 1;

/** The keys `effectLiteral` writes, in this order (every `EffectProps` option but `repeat`). */
const KEY_ORDER = [
  "kind",
  "direction",
  "rotateDirection",
  "breathePlain",
  "reversed",
  "drawIndividually",
  "drawReversedOrder",
  "variableValue",
  "fill",
  "reversing",
  "inactive",
  "byLayer",
  "speed",
] as const;

/** Whether `value` is the effect's default for `key`, so it need not be written. */
function isDefault(key: string, value: unknown): boolean {
  if (value === undefined || value === "") return true;
  if (key === "speed") return value === SPEED_DEFAULT;
  const meta = (OPTION_META as Record<string, OptionMeta | undefined>)[key];
  if (meta?.type === "choice") return value === meta.default;
  return meta?.type === "toggle" && value === meta.default;
}

export type OptionValues = Partial<Record<OptionKey, string | boolean | number>>;

/** Variable Color with a `variableValue`: a still frame, so the animated options, speed and repeat do not apply. */
export function isStill(kind: PanelKind, values: OptionValues): boolean {
  return kind === "variableColor" && values.variableValue !== undefined;
}

/**
 * Whether option `key` applies under the other values: Reverse order is a Draw Off option, and
 * Variable Color's fill, reversing and inactive shape the animated form only.
 */
export function optionApplies(kind: PanelKind, key: OptionKey, values: OptionValues): boolean {
  if (key === "drawReversedOrder") return values.reversed === true;
  if (key === "fill" || key === "reversing" || key === "inactive") return !isStill(kind, values);
  return true;
}

/** The fields an `EffectProps` may carry; every member of the union is assignable to it. */
type EffectFields = { kind: PanelKind } & { readonly [K in OptionKey | "speed" | "repeat"]?: unknown };

/** The effect for the panel's settings: only `kind`'s options, and only those not at their default. */
export function buildEffect(kind: PanelKind, values: OptionValues, speed: number, repeat: "once" | "continuous"): EffectProps {
  const e: { -readonly [K in keyof EffectFields]: EffectFields[K] } = { kind };
  for (const key of EFFECT_OPTIONS[kind] as readonly OptionKey[]) {
    const v = values[key];
    // A value left from an option that no longer applies reaches neither the JSX nor the preview.
    if (!optionApplies(kind, key, values)) continue;
    if (!isDefault(key, v)) e[key] = v;
  }
  if (isStill(kind, values)) return e as EffectProps;
  if (!isDefault("speed", speed)) e.speed = speed;
  if (repeat === "continuous" && REPEATS[kind]) e.repeat = "continuous";
  return e as EffectProps;
}

/** `{ kind: "bounce", direction: "down" }`: the non-default options, `repeat` left out. */
export function effectLiteral(effect: EffectProps): string {
  const rec: EffectFields = effect;
  const parts: string[] = [];
  for (const key of KEY_ORDER) {
    const v = rec[key];
    if (key !== "kind" && isDefault(key, v)) continue;
    parts.push(`${key}: ${JSON.stringify(v)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

/**
 * The prop that plays the effect: `visible` for Appear and Disappear (a transition), `active` for a
 * continuous effect and for Variable Color's still frame, else a `trigger` whose every change plays it once.
 */
export function companionProp(effect: EffectProps): string {
  if (effect.kind === "appear" || effect.kind === "disappear") return "visible={visible}";
  if (effect.kind === "variableColor" && effect.variableValue !== undefined) return "active={active}";
  if ("repeat" in effect && effect.repeat === "continuous") return "active={active}";
  return "trigger={count /* each change plays it */}";
}
