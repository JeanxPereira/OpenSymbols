# OpenSymbols: design

**Date:** 2026-11-09
**Status:** draft, awaiting approval

## 1. What this is

OpenSymbols is to SF Symbols what `lucide-react` is to Lucide: tree-shakable React
components, one per symbol, with props for everything the symbol supports. On top of
what lucide offers, it supports what SF Symbols has and Lucide does not: the weight axis,
the four rendering modes, variable values and the symbol effects. It ships with a demo
page that browses the library and previews every one of those knobs live, and stays
light while doing it.

OpenSymbols is **TypeScript from end to end and standalone**: the catalog decoder, the
generator, the runtime and the effects engine are all written here, in TS. It has no
build, runtime or test dependency on any other project.

The geometry belongs to Apple. The SF Symbols license allows the symbols in mockups and
in apps for Apple platforms; republishing them as a web icon set is not covered. So
OpenSymbols ships **no Apple data at all**. It ships the machinery, and each user
generates the symbol package from their own copy of the catalog ("bring your own
catalog"). The authors use the generated package internally, under their own copy.

The catalog exists only inside a macOS install: the SF Symbols `.dmg` carries metadata
and fonts but no vector data. So generating needs a Mac, or a `CoreGlyphs.bundle` copied
from one; the generator itself runs anywhere Node runs.

## 2. Goals

1. A generator that runs on Windows, macOS and Linux: catalog directory in,
   ready-to-import React package out.
2. React components with lucide's ergonomics (`import { Wifi } from "..."`, one module
   per symbol, `size`, `color`, `className`) plus SF Symbols' own axes.
3. All four rendering modes: monochrome, hierarchical, palette, multicolor, including
   the knockout layers (`-sfsymbols-clear-behind`).
4. Weight: the nine named weights and a continuous value.
5. Variable value (0..1), in both of the catalog's modes: `color` (per-layer threshold)
   and `draw` (`-sfsymbols-variable-draw`).
6. Every symbol effect with its options, behaving keyframe for keyframe like Apple's
   (RenderBox 8.0.84): Appear, Disappear, Bounce, Breathe, Draw On/Off, Pulse, Rotate,
   Scale, Replace, Magic Replace, Wiggle and Variable Color, including Variable Color's
   animated forms (iterative, cumulative, reversing; animated forms pending, §9.2).
7. A demo page that previews all of the above for any symbol, opens fast and stays
   smooth with the full public catalog.
8. Animation is opt-in: a project that only draws static icons pays nothing for the
   effects engine.

## 3. Non-goals (v1)

- The private catalog (`CoreGlyphsPrivate`). The generator reads only `public/`.
- Frameworks other than React. The core is framework-free so Vue/Svelte/Solid wrappers
  can come later, but none ship in v1.
- A font build (`.woff2` with ligatures). Fonts cannot carry layers or effects.
- Raster output (PNG). Everything is SVG.
- `GlyphSize` Small/Medium/Large: the transform CoreUI applies
  (`+[CUIVectorGlyphMutator transformForGlyphSize:]`) is not decoded. v1 has `size` only.
- Localized drawings (rendition token 13 and the `.ar`/`.hi`-suffixed facets). The
  generator records which locales exist so a later version can add them, and draws the
  base.
- Extracting `CoreGlyphs.bundle` from an IPSW or a macOS installer.

## 4. Anti-goals

- **Any Apple byte in a published artifact.** No geometry, no catalog, no `colors-26.csv`,
  no metadata plists in the git repo, the npm tarballs, the CI caches or the test
  fixtures (§11).
- **An approximation shown as Apple's output.** Wherever OpenSymbols draws something it
  did not decode (an intermediate weight, the stand-in palette, a catalog build nobody
  validated), the API flags it and the demo says so on screen.
- **A number with no source.** Every format fact and every animation constant in the
  code points at the document in `Docs/` that states it and where it was read. A
  constant nobody can trace is a bug.
- **A heavy demo.** If the demo needs to load the whole catalog's geometry before it can
  show a grid, it has failed even if everything renders correctly.

## 5. Shape of the system

```
user's catalog dir ──► opensymbols generate  (Node CLI, uses @opensymbols/decode)
                              │
                              ▼
                   generated package (user's disk, never published)
                     ├─ index.json          names, aliases, categories, search terms
                     ├─ symbols/*.js        one ESM module per symbol (data + component)
                     └─ chunks/*.json       geometry batches for the demo
                              │
     ┌────────────────────────┼─────────────────────────┐
     ▼                        ▼                         ▼
@opensymbols/core     @opensymbols/react        @opensymbols/animate
 (data model,          (createIcon, <Replace>,   (effects engine:
  weight interp,        effect props)              pure sample(drawing, spec, t))
  paint, SVG model)
                              │
                              ▼
                       apps/demo (Vite + React, local)
```

pnpm monorepo, TypeScript strict, Vitest:

| path | package | holds |
|---|---|---|
| `packages/decode` | `@opensymbols/decode` | BOM store, asset catalog (`.car`), the `BVG ` format, plists, building a drawing |
| `packages/cli` | `opensymbols` | the `generate`, `dump` and `demo` commands |
| `packages/core` | `@opensymbols/core` | types, weight interpolation, paint resolution, SVG tree builder |
| `packages/react` | `@opensymbols/react` | the React runtime the generated modules import |
| `packages/animate` | `@opensymbols/animate` | the effects engine |
| `apps/demo` | (not published) | the demo page |

`@opensymbols/decode` works on `Uint8Array`s, not on files; only the CLI touches the
disk. It runs at generation time and is never in a user's app bundle.

## 6. The format, written down first

Before the decoder, `Docs/` gets the format specification it implements, one document
per layer, each claim tagged with where it was read: the BOM container and the
rendition key; the `BVG ` header, string pool, node tree, nibble path codec and numeric
lists; the style block (class records, rules, the `.monochrome-`/`.multicolor-`/
`.hierarchical-`/`.shapeGroupLayer-` families) and the `-sfsymbols-*`
animation properties; the metadata plists; the effects' keyframe tables and timing
curves.

The code is written from these documents, and its comments cite them. This is what
makes "a number with no source" checkable (§4).

## 7. The generator

### 7.1 Input

`opensymbols generate --catalog <dir> --out <dir>` (also `$SF_CATALOG_DIR`). `<dir>`
holds `public/` (an extracted `CoreGlyphs.bundle`, copied from
`/System/Library/CoreServices/` on a Mac) and, optional, `app/` (the SF Symbols app's
metadata: categories, search terms, variants, layer-set availability and
`colors-26.csv`; these come out of the SF Symbols `.dmg` on any OS, and the CLI can
unpack them from the `.dmg` itself, or the README explains how). The README says plainly
that `public/` needs a Mac or a copy from one.

Without `app/`, the package still builds; categories and search terms are empty, and
multicolor falls back to the stand-in palette, flagged (§8.3).

**Catalog builds.** The reference build is macOS 27 beta 6, `26A5416b`: 8,527 public
symbols, 31,029 public `BVG ` documents. The generator reads the catalog's build,
accepts any, and records it in `index.json` with `validated: true` only for builds on a
list kept in the CLI (one entry at first). An unvalidated build still generates; the CLI
warns and the demo shows it. A per-symbol decode failure is reported by name and the
symbol is skipped, never half-written.

### 7.2 Per-symbol data

For each public symbol, for each `(Appearance, Direction)` combination it has (a few
hundred symbols carry two: a dark-appearance or a right-to-left drawing):

- `viewBox`, the group `transform`, the metrics (reference point size, baseline, cap
  height, insets) and rotation anchor / metric centre;
- the three masters (GlyphWeight 1, 4, 9: Ultralight, Regular, Black) as flat point
  arrays plus one shared command list. The masters must be point-compatible (CoreUI
  refuses to interpolate otherwise); the generator **checks it per symbol and fails
  loudly** on a mismatch;
- per layer: role, paint class (tint, role, named colour, fixed hex), `opacity`,
  clear-behind, motion group, tags, variable threshold, variable draw pair, always
  rotates, always pulses, stroke keyframes, family layer, clip-stroke attachments;
- per document: draw-reverses-motion-groups, variable-value mode, vc-continuous, wiggle
  style and angle, rotates-clockwise, shape groups, draw attachment data;
- availability per rendering mode, so the component knows a symbol has no multicolor
  drawing instead of guessing.

The output format is versioned (`formatVersion` in `index.json`); the runtime refuses a
package from a newer major.

### 7.3 Output

- `symbols/<name>.js`: one ESM module per symbol, exporting the component built by
  `createIcon(data)` from `@opensymbols/react`. Data is inlined as compact arrays, not as
  SVG strings, because weight interpolation needs points.
- `index.js`: re-exports every component, `sideEffects: false`, so bundlers tree-shake.
- `index.json`: name, aliases, categories, search terms, availability year, variants,
  modes available, chunk id. Small enough to load whole in the demo.
- `chunks/<n>.json`: geometry batched for the demo's on-demand loading.
- `package.json`, so the output installs with `file:` or from a private registry.

`--masters regular` bakes a single master (smaller output; `weight` then accepts only
`regular`). Default is all three.

### 7.4 Names

A symbol name becomes a component name by a fixed rule: split on `.`, PascalCase each
part, and when the result starts with a digit, put `Sf` in front (`wifi` → `Wifi`,
`0.circle` → `Sf0Circle`, `arrow.up.circle.fill` → `ArrowUpCircleFill`). The generator
checks the mapping is injective over the catalog it read and stops on a collision,
printing both names. Aliases are re-exports of the same module.

Localized facets (`0.circle.ar`, `*.zh`, ...; 1,317 of the reference build's public
names) are not components in v1; `index.json` lists them under their base symbol. RTL
mirroring is the `Direction` axis of the base symbol, not a facet, and is supported.

### 7.5 `dump`

`opensymbols dump NAME` prints a decoded document in a canonical text form, and
`dump --all` every one. It is the decoder's debugging and regression tool (§10.1).

## 8. Runtime: `@opensymbols/core` and `@opensymbols/react`

### 8.1 Component API

```tsx
import { Wifi } from "my-symbols";

<Wifi
  size={24}                        // px, default 24; see "Size" below
  weight="semibold"                // ultralight..black, or a number in [1, 9]
  mode="hierarchical"              // monochrome | hierarchical | palette | multicolor
  color="currentColor"             // tint; monochrome and hierarchical
  palette={["#0a84ff", "#30d158"]} // palette mode, one colour per role
  variableValue={0.6}              // 0..1, when the symbol supports it
  appearance="dark"                // picks the dark drawing when one exists
  title="Wi-Fi"                    // accessible name; decorative (aria-hidden) when absent
/>
```

**Size.** SF Symbols are not square: the viewBox is wider or narrower per symbol and
grows with weight (`wifi` is 10.97, 11.31 and 12.14 wide at the three masters). Two
layouts:

- `layout="box"` (default, the lucide drop-in): the `<svg>` is `size`×`size`; the
  symbol is scaled to fit by its regular-master box and centred, so changing weight
  never reflows the page and a grid of mixed symbols lines up.
- `layout="text"`: SF semantics. `size` is the point size; height follows the symbol's
  metrics, width is the symbol's own, and the icon sits on the text baseline. For icons
  inline with text.

Output is plain SVG: one `<svg>`, one `<g>` with the group transform, one `<path>` per
layer. Knockout layers become an SVG `<mask>` whose id comes from `useId`, so two
instances never share one. RTL comes from the nearest `dir="rtl"` ancestor and picks the
mirrored drawing when the symbol has one, overridable with a `direction` prop.

### 8.2 Weight

Interpolation is CoreUI's formula:
`p = regular + s_ul·(ultralight − regular) + s_b·(black − regular)`.

The scalar table that maps the nine weights to `(s_ul, s_b)`
(`+[CUIVectorGlyphMutator _interpolationData]`) is **not decoded**. v1 ships a
provisional table: Ultralight, Regular and Black exact; the six others placed linearly
between the masters. The table lives in one module, marked as an inference, so replacing
it with the decoded one is a one-file change. Every API that returns geometry also
returns `approximate: boolean`, true for any weight that is not a master; the demo shows
it.

### 8.3 Paint

- **Monochrome:** every layer in the tint.
- **Hierarchical:** the tint at the role's level: primary 1.0, secondary 0.5, tertiary
  0.18 light and 0.25 dark (read from the app's `colors-26.csv`).
- **Palette:** one colour per role; with fewer colours than roles, the last one repeats
  (SwiftUI's rule).
- **Multicolor:** named colours (`systemBlueColor`, ...) resolved from `colors-26.csv`
  when the generator found one, light or dark per `appearance`. Without it, a built-in
  stand-in palette, recorded as `palette: "stand-in"`; the demo says so. Fixed hex
  fills belong to the multicolor reading and are drawn as-is there.

## 9. Animation: `@opensymbols/animate`

### 9.1 Engine

A pure function `sample(drawing, spec, t) → LayerState[]`, plus `duration(drawing,
spec)` and `loopStart(drawing, spec)`. No clock in the engine. A `LayerState` is what one
layer gets at one instant: an extra transform, an alpha factor, the Draw clip range
(`strokeStart`, `strokeEnd`), a visibility bit, the attachment scale and per-subpath
transforms for the Draw riders. `Spec` carries the effect kind, repeat, speed, by-layer,
direction, reversed, Breathe plain, Replace style and half, Draw individually and
reversed order, the rendering mode, and the variable value.

Inside: keyframe tracks per property over RenderBox's 42 timing curves, a plan per
effect, motion-group stagger, Replace and Magic Replace, the Draw clip with its riders,
and Variable Color.

The Draw clip is the expensive part. Symbols are filled outlines, so `stroke-dasharray`
cannot draw them; the clip cuts the outline along each layer's stroke-keyframe progress
field, recomputed per frame.

### 9.2 Variable Color's timeline: read before it ships

The static form (a value 0..1 lighting layers by threshold) is fully known. The animated
forms SwiftUI offers (iterative, cumulative, reversing, with dim-inactive and
hide-inactive) are **not yet read out of RenderBox**. Decided by the user: their timing
is decoded first and written into `Docs/` like every other effect; only then does the
engine implement them. Only Variable Color's animated forms wait on this; the static
`variableValue` and every other effect proceed in parallel.

The engine's internal "Color" kind has no keyframes in RenderBox and is not part of the
API.

### 9.3 React API

Modelled on SwiftUI's `symbolEffect`, the vocabulary SF Symbols users already know:

```tsx
// indefinite: runs while active
// (Variable Color's animated forms are pending, P5, §9.2: `variableColor` holds a static value only)
<Wifi effect={{ kind: "pulse" }} active={isSearching} />

// discrete: plays once each time `trigger` changes
<Bell effect={{ kind: "bounce", direction: "up", byLayer: true }} trigger={count} />

// transition
<Wifi effect={{ kind: "appear" }} visible={online} />

// replace: swap to another symbol
<Replace from={PlayFill} to={PauseFill} show={playing ? "to" : "from"} style="downUp" magic />

// imperative: `effectRef` receives the handle; `ref` stays the <svg> element
const handle = useRef<SymbolHandle>(null);
<Bell effectRef={handle} />
handle.current?.play({ kind: "wiggle" });
handle.current?.stop();
```

Effect props are a discriminated union on `kind`: `direction` only on the kinds that take
it, `replaceStyle` only on Replace, and so on.

The driver is one shared `requestAnimationFrame` loop for every animating instance on
the page. Each frame it writes per-layer `transform`, `opacity` and (Draw only) `d`
straight to the DOM through refs, never through React state. Under
`prefers-reduced-motion` effects jump to their end state.

`@opensymbols/react` does not depend on `@opensymbols/animate`. Effect props work once
the animate package is registered (`import "@opensymbols/animate/react"` once in the
app), so a static-only app does not bundle the engine.

## 10. Verification

### 10.1 The decoder's gate

Run over a real catalog (`SF_CATALOG_DIR`), never in public CI:

- every `BVG ` document in `public/` decodes, counted, not sampled (31,029 on the
  reference build);
- every style block parses with each rule offset landing on a rule boundary and no rule
  that no class points at;
- every symbol's three masters are point-compatible;
- `dump --all` is written to a git-ignored file and kept as the regression baseline: a
  later change to the decoder must leave it byte-identical or explain the difference.

### 10.2 The engine

- Unit tests on hand-made toy drawings (a square; two triangles in two motion groups;
  a stroke with keyframes and a rider) check each effect's keyframes, durations and
  stagger against the values in `Docs/`.
- The 42 curves are tested at their endpoints and at sample points stated in `Docs/`.
- A local snapshot suite samples a fixed list of real symbols × effects × options × `t`
  and stores the results git-ignored, as a regression baseline like `dump --all`.

### 10.3 The runtime

- Component tests (Vitest + Testing Library) on toy data: props to SVG, masks with
  unique ids, `approximate` flags, RTL selection.
- The demo's budget (my call): first paint of the grid under 1 s on a warm local server;
  scrolling the full catalog at 60 fps on the authors' machine.

## 11. Keeping Apple data out

- `.gitignore` covers catalog directories, generated packages, dumps and snapshots.
- CI runs `npm pack` on each package and fails on any file under `symbols/` or
  `chunks/`, any JSON with a `masters` key, or any long SVG path data in the published
  sources.
- Unit tests use toy drawings only.

## 12. The demo

### 12.1 Running it

`opensymbols demo --package <generated dir>` starts a local Vite server over the user's
generated package. There is no public deployment with symbols in it. A public landing
page (what this is, the API, how to generate) may exist but draws no SF Symbol.

### 12.2 Staying light

- First paint loads only `index.json` and the app shell.
- The grid is virtualized: only visible cells exist in the DOM.
- Geometry arrives per chunk as cells scroll into view; the grid draws the regular
  master only, monochrome, with no animation runtime.
- The inspector loads the selected symbol's full data and the animate package lazily
  (dynamic `import()`).

### 12.3 What it shows

Laid out like the SF Symbols app, as a web page: sidebar of categories, toolbar with
search and grid/list switch, grid, and an inspector on the right.

- **Search:** name, aliases, search terms; categories in the sidebar.
- **Rendering:** mode, tint, palette colours (one picker per role), appearance
  light/dark, variable value slider (only for symbols that have one), weight as nine
  stops and a continuous slider. A visible "approximate" badge whenever the weight is
  not a master, the palette is the stand-in, or the catalog build is unvalidated.
- **Animation:** every effect, with exactly the options that effect takes; speed; once
  or continuous; play, pause, and a **timeline scrubber** (the engine is a pure function
  of `t`, so scrubbing is free).
- **Replace:** pick a second symbol and play Replace or Magic Replace between them.
- **Copy:** the import line, the JSX with the current props, and the static SVG of the
  current frame.
- **Info:** name, aliases, availability year, categories, modes available, variants.

## 13. Decided by the user

- Distribution model (a): OpenSymbols is public; each user generates the symbols from
  their own catalog. The authors' own use is the generated package, private.
- OpenSymbols is TypeScript end to end and standalone: no dependency on, or link to,
  any other project.
- Variable Color's animated forms are decoded before they are implemented (§9.2).
- Skip the interview; this document's defaults stand until corrected.

## 14. My calls (check these)

- License MIT, covering OpenSymbols' code only; the README states the symbols are
  Apple's and under Apple's license.
- Name and scope `opensymbols` / `@opensymbols/*` (npm availability not checked).
- Format docs written before the decoder (§6).
- Provisional linear weight table, flagged `approximate`.
- SwiftUI-shaped effect API (`effect` + `trigger` / `active` / `visible`).
- `size` defaults to a lucide-style square box; SF point-size layout is `layout="text"`.
- React only; private catalog, GlyphSize, localized drawings and IPSW extraction out of
  v1.
- Component naming rule of §7.4.
- Any catalog build accepted; only validated builds are unflagged.
- pnpm monorepo, Vite for the demo, Vitest for tests, TypeScript strict.

## 15. Left to the builder

- Exact compact encoding of points in the generated modules, as long as a typical icon
  stays small next to a lucide icon at one master.
- Chunk size and how symbols are grouped into chunks.
- Visual design of the demo within §12.3.
- How the shared rAF loop schedules instances.
- Whether the CLI unpacks `app/` from the `.dmg` itself in v1 or documents it.

## 16. Open questions

- The nine-weight scalar table (§8.2).
- Variable Color's animated timing (§9.2; to be decoded, not open-ended).
- The GlyphSize transform (§3).
- `data-d` on variable-draw symbols: five numbers whose meaning is not yet read; Variable
  Draw is implemented from what is known and this stays flagged.
- No pixel comparison against Apple's renderer exists; the demo makes no claim that it
  matches Apple pixel for pixel.
