/**
 * Why a render is not exact, one entry per `data-approximations` reason. Same wording as the
 * README's reason table (a test keeps them in step); backticks mark code.
 */
export const REASONS = {
  weight: "the weight lies between two stored masters and is interpolated with a provisional (linear) table",
  "weight-unavailable": "the weight needs a master the package does not have (`--masters regular`): drawn at regular",
  mode: "the symbol does not offer the requested `mode`: drawn in monochrome",
  palette: "`multicolor` with stand-in colours (no `app/colors-26.csv`)",
  "variable-value": "a `variableValue` was applied: the dimmed look of inactive layers is approximated",
  "variable-draw": "the symbol's variable value draws its paths; a `variableValue` is ignored",
  "text-layout": '`layout="text"`: the scale and baseline rules are inferred, not decoded',
  metrics: '`layout="text"` on a symbol without glyph metrics: sized like the box layout, with no baseline shift',
  build: "the package was generated from a catalog that is not the validated build (`build.validated` is false)",
} as const satisfies Record<string, string>;

export type Reason = keyof typeof REASONS;

/** The text for a reason, or undefined for one this demo does not know. */
export function reasonText(reason: string): string | undefined {
  return Object.hasOwn(REASONS, reason) ? REASONS[reason as Reason] : undefined;
}
