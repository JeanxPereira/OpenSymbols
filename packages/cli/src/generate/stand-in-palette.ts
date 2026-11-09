import type { ColourOrigin, Palette } from "./encode.js";

/**
 * [INF] The fallback colours for names the user's `app/colors-26.csv` (Docs/format/05 §3.5)
 * does not carry, or for every name when there is no `app/`: one light and one dark CSS colour
 * for every colour name in the multicolor vocabulary (Docs/format/02 §3, atoms 66–88, less
 * `tintColor`, which the decoder maps to the tint, and `custom`, which arrives as a literal
 * `fill`). A name in neither the user's file nor this table (a `custom` with no `fill`, a
 * local colour name) is drawn in the tint with a warning, and marks the symbol "stand-in".
 * Apple's own RGB values are never stored here (05 §3.5: they are read from the user's copy).
 *
 * Why [INF]: these are the publicly documented system colour values (the iOS/macOS
 * Human Interface Guidelines sRGB tables and the AppKit label-colour alphas), not values read
 * from a catalog, so they can drift from what a given SF Symbols build draws. The choices:
 * - system hues: the HIG default (not increased-contrast) light and dark values;
 * - label colours: black / white at the macOS label alphas (85 / 50 / 26 / 10 % light,
 *   85 / 55 / 25 / 10 % dark);
 * - `controlAccentColor`: the default accent, which is system blue;
 * - `knockout`: fully transparent. The format names it a multicolor colour (04 §2.2), not the
 *   erase, which is `-sfsymbols-clear-behind`; a layer painted "knockout" is taken to show
 *   nothing of its own. To be measured on the real catalog: how often a multicolor `knockout`
 *   paint comes with `clearBehind: true` (if always, transparent is moot; if never, it is a guess).
 *
 * `black` and `white` are not stand-ins: their values are exact, so their origin is "exact".
 */
const COLOURS: ReadonlyArray<readonly [name: string, light: string, dark: string]> = [
  ["black", "#000000", "#000000"],
  ["white", "#ffffff", "#ffffff"],
  ["knockout", "#00000000", "#00000000"],
  ["controlAccentColor", "#007aff", "#0a84ff"],
  ["labelColor", "#000000d9", "#ffffffd9"],
  ["secondaryLabelColor", "#00000080", "#ffffff8c"],
  ["tertiaryLabelColor", "#00000042", "#ffffff40"],
  ["quaternaryLabelColor", "#0000001a", "#ffffff1a"],
  ["systemRedColor", "#ff3b30", "#ff453a"],
  ["systemOrangeColor", "#ff9500", "#ff9f0a"],
  ["systemYellowColor", "#ffcc00", "#ffd60a"],
  ["systemGreenColor", "#34c759", "#30d158"],
  ["systemMintColor", "#00c7be", "#63e6e2"],
  ["systemTealColor", "#30b0c7", "#40c8e0"],
  ["systemCyanColor", "#32ade6", "#64d2ff"],
  ["systemBlueColor", "#007aff", "#0a84ff"],
  ["systemIndigoColor", "#5856d6", "#5e5ce6"],
  ["systemPurpleColor", "#af52de", "#bf5af2"],
  ["systemPinkColor", "#ff2d55", "#ff375f"],
  ["systemBrownColor", "#a2845e", "#ac8e68"],
  ["systemGrayColor", "#8e8e93", "#8e8e93"],
];

/** Colours whose value is exact by definition, whatever the palette's source. */
const EXACT: ReadonlySet<string> = new Set(["black", "white"]);

export const STAND_IN_PALETTE: Palette = {
  source: "stand-in",
  light: new Map(COLOURS.map(([name, light]) => [name, light])),
  dark: new Map(COLOURS.map(([name, , dark]) => [name, dark])),
  origin: new Map(COLOURS.map(([name]): [string, ColourOrigin] => [name, EXACT.has(name) ? "exact" : "stand-in"])),
};

/**
 * The palette `generate` encodes with: the user's colors-26.csv colours (`apple`, from
 * `Catalog.appMetadata.palette`) layered over STAND_IN_PALETTE. Without `apple` it is a copy
 * of STAND_IN_PALETTE. A name Apple's file carries in only one of light / dark is not taken
 * from it (the loader never produces that; this keeps the pair consistent).
 */
export function buildPalette(apple?: {
  light: ReadonlyMap<string, string>;
  dark: ReadonlyMap<string, string>;
}): Palette {
  const light = new Map(STAND_IN_PALETTE.light);
  const dark = new Map(STAND_IN_PALETTE.dark);
  const origin = new Map(STAND_IN_PALETTE.origin);
  if (apple === undefined) return { source: "stand-in", light, dark, origin };
  for (const [name, l] of apple.light) {
    const d = apple.dark.get(name);
    if (d === undefined) continue;
    light.set(name, l);
    dark.set(name, d);
    origin.set(name, "apple");
  }
  return { source: "apple", light, dark, origin };
}
