# OpenSymbols

OpenSymbols is a TypeScript toolkit that turns your own copy of Apple's SF Symbols catalog into an icon package for the web, in the spirit of lucide-react. A decoder reads the catalog files and a CLI generates the package from them.

## Bring your own catalog

This repository and its npm packages contain no Apple data. You supply the catalog from your own Mac and generate the icon package locally. Nothing derived from the catalog is committed or published from here.

## The catalog root

The CLI reads a catalog root directory, given with `--catalog DIR` or `$SF_CATALOG_DIR`:

```
<root>/
  public/        the contents of CoreGlyphs.bundle/Contents/Resources, flattened:
    Assets.car   the symbol drawings
    *.plist      the bundle's metadata (name_availability.plist, symbol_search.plist, ...)
    *.strings    name_aliases.strings and the other .strings files
  app/           optional: the SF Symbols app's Resources/Metadata files, plus colors-26.csv
```

`CoreGlyphs.bundle` is in `/System/Library/PrivateFrameworks/SFSymbols.framework/Versions/A/Resources/`
on a Mac. Keep the root outside this repository, or under `catalog/`, which git ignores.

## Running the decoder's checks

```sh
pnpm install && pnpm build
node packages/cli/dist/main.js gate --catalog /path/to/root
node packages/cli/dist/main.js dump --all --out catalog.dump.txt --catalog /path/to/root
```

`gate` decodes every drawing, checks that each symbol's three masters have the same shape,
and prints `documents=… failures=… incompatible=… skipped=…`; it exits 0 only when all
three counts are zero, 1 otherwise, and 2 on a usage error or a missing catalog.
`dump --all` writes the canonical text form of every drawing, the decoder's regression
baseline; it writes to `FILE.tmp` and renames it only when every drawing dumped. Both
outputs stay on your machine: `*.dump.txt` is git-ignored.

## Generate your package

```sh
pnpm install && pnpm build
node packages/cli/dist/main.js generate --catalog /path/to/root --out ../my-icons
```

Options: `--name PKG` sets the package name (default `opensymbols-local`); `--masters regular`
keeps only the regular weight (smaller output; every `weight` then renders as regular)
instead of the default `all`, which keeps ultralight, regular and black and interpolates
between them.

`--out` must be a new or empty directory, or the output of a previous `generate`, which is
then replaced. Any other non-empty directory is refused. The output:

```
my-icons/
  package.json         private, ESM, peer dependencies @opensymbols/react and react >= 19
  index.js, index.d.ts one named export per symbol, plus the legacy alias names
  index.json           the build fingerprint, the palette, every symbol's name, component,
                       aliases, categories, search terms, year, render modes and chunk; the
                       skipped symbols with their reasons; the localized and right-to-left
                       facets, each with the base symbol and the locale or direction it became
  symbol.d.ts          the one type declaration every symbol module shares
  symbols/<Component>.js  one module per symbol, its data in format 2
```

Each symbol module carries its data in a compact form (format 2: path values delta-encoded,
default values left out, `viewBox` rounded to 6 significant digits), which the runtime
expands once, on first use. Localized drawings live in their base symbol:
`0.circle.ar` is `Sf0Circle` with `locale="ar"`, not a component of its own, and a `.rtl`
facet becomes its base symbol's right-to-left drawing.

The report on stderr lists the symbols that could not be encoded, grouped by reason. A
skipped symbol does not stop the run; if more than 1% of the symbols are skipped the package
is still written but the command exits 1. Exit 2 is a usage error: no catalog, a refused
`--out`, or an unreadable `app/` file.

The runtime packages, `@opensymbols/react` and `@opensymbols/core`, are not published to npm
yet. Until they are, pack them from your build of this repository (`pnpm pack`, not
`npm pack`: it rewrites the `workspace:` dependency of `react` on `core`) and install the
tarballs with the generated package:

```sh
# in this repository, after pnpm build
(cd packages/core && pnpm pack --pack-destination ../../out)
(cd packages/react && pnpm pack --pack-destination ../../out)

# in your app
npm install --install-links \
  /path/to/OpenSymbols/out/opensymbols-core-0.1.0.tgz \
  /path/to/OpenSymbols/out/opensymbols-react-0.1.0.tgz \
  file:../my-icons react react-dom
```

`--install-links` makes npm copy the generated package into `node_modules` instead of
symlinking it; through a symlink, Node resolves `@opensymbols/react` from `../my-icons` and
does not find it. These steps were checked with npm and Node 24 (import and server render);
pnpm, yarn and bundler setups are untested.

Import each icon from its own module (a deep import, through the package's `exports` map):

```tsx
import Wifi from "opensymbols-local/Wifi";
import HeartFill from "opensymbols-local/HeartFill";
import Sf0Circle from "opensymbols-local/Sf0Circle";

<Wifi size={32} weight="semibold" mode="hierarchical" color="#0a84ff" />
<HeartFill weight={7.5} mode="multicolor" layout="text" title="Favourite" />
<Wifi scale="large" layout="text" />
<Sf0Circle locale="ar-EG" />
```

The barrel works too (`import { Wifi, HeartFill } from "opensymbols-local"`), and production
bundles drop the icons you do not use: the package has `sideEffects: false` and every
`createIcon` call is marked `/*#__PURE__*/`. Dev servers do not tree-shake, though, and a
barrel import there loads every icon module. With Vite, keep the package out of the
dependency pre-bundling, `optimizeDeps: { exclude: ["opensymbols-local"] }` in
`vite.config`; with Next.js, list it in `experimental.optimizePackageImports` in
`next.config`, which rewrites barrel imports into deep ones. The `exports` map also exposes
`opensymbols-local/index.json`.

Component names are the symbol names in PascalCase (`heart.fill` → `HeartFill`; a name that
starts with a digit gets an `Sf` prefix). The props, all optional:

| prop | default | |
|---|---|---|
| `size` | `24` | the edge of the square in px (`layout="box"`), or the font size the icon is set to (`layout="text"`) |
| `weight` | `"regular"` | a weight name (`ultralight` … `black`) or a number from 1 (ultralight) to 9 (black); a fraction lies between its two neighbours |
| `scale` | `"medium"` | `"small"`, `"medium"` or `"large"`, SwiftUI's `imageScale`: the weight is redrawn for the scale, and with `layout="text"` the icon grows (×1.276 at medium, ×1.647 at large, against small) about the middle of the cap height; with `layout="box"` it still fits its square |
| `mode` | `"monochrome"` | `monochrome`, `hierarchical`, `multicolor` or `palette`; a mode the symbol does not have is drawn in monochrome |
| `color` | `"currentColor"` | the tint |
| `palette` | | the colours of `palette` mode, by layer role: primary, secondary, tertiary; the last one repeats, and with none the tint is used |
| `variableValue` | | 0 to 1: the symbol's variable-colour layers light up as the value passes each layer's threshold |
| `appearance` | `"light"` | `"light"` or `"dark"`: the symbol's dark variant when it has one, and the dark multicolor colours and hierarchy levels |
| `locale` | | a BCP-47 tag (`"ar"`, `"zh-Hant"`): the symbol's drawing for that tag, else for its language (`"ar-EG"` → `"ar"`), else the first stored tag of that language (`"zh"` → `"zh-Hans"`), else the base drawing |
| `direction` | `"auto"` | `"ltr"`, `"rtl"` or `"auto"`: the right-to-left variant when the symbol has one; `auto` renders left-to-right, then follows the nearest `dir` attribute after mount |
| `layout` | `"box"` | `"box"` fits the icon, centred, in a `size` square that no weight changes; `"text"` sizes it to text of font size `size` and sets it on the baseline |
| `title` | | an accessible name; without it the icon is `aria-hidden` |

Other SVG props (`className`, `style`, `aria-*`, handlers) go to the `<svg>`.

Every weight, named or fractional, at every scale, is computed with CoreUI's own scalar
table (`Docs/format/01-bom-and-car.md` §5.2), as Apple computes it. When a render is not
exact, the `<svg>` carries `data-approximate="true"` and `data-approximations`, a
space-separated list of reasons:

| reason | the render is not exact because |
|---|---|
| `weight-unavailable` | the weight needs a master the package does not have (`--masters regular`): drawn at regular |
| `mode` | the symbol does not offer the requested `mode`: drawn in monochrome |
| `palette` | `multicolor` with stand-in colours (no `app/colors-26.csv`) |
| `variable-value` | a `variableValue` was applied: the dimmed look of inactive layers is approximated |
| `variable-draw` | the symbol's variable value draws its paths; a `variableValue` is ignored |
| `text-layout` | `layout="text"`: the scale and baseline rules are inferred, not decoded |
| `metrics` | `layout="text"` on a symbol without glyph metrics: sized like the box layout, with no baseline shift |
| `build` | the package was generated from a catalog that is not the validated build (`build.validated` is false) |

Two fields of `index.json` say how far to trust the output:

- `palette` is `"apple"` when `app/colors-26.csv` was present, so multicolor symbols use
  Apple's colours; `"stand-in"` means approximations were used (each symbol's data says the
  same, per symbol).
- `build.validated` is `true` only when the catalog is the build this project's format notes
  and renderer were checked against (CoreUI 1010, 157,938 renditions, 8,527 facets). Any
  other build is still generated, with a warning: it may decode correctly, but nobody has
  compared it. Every symbol of such a package renders with the `build` reason. A catalog
  whose header cannot be read has `coreuiVersion` and `renditionCount` `null` and is never
  validated.

Generated packages contain Apple's symbol drawings: keep them out of public repositories and
registries.

## Effects

`@opensymbols/animate` adds symbol effects in the vocabulary of SwiftUI's `symbolEffect`. It
is a separate package: an app that only renders icons never bundles it (a test builds such an
app and checks). Pack it like the other runtime packages
(`cd packages/animate && pnpm pack --pack-destination ../../out`) and register it once, in
client code, before the animated icons mount:

```tsx
import "@opensymbols/animate/react";
```

The import installs the effects driver into `@opensymbols/react`. Until it has run, the effect
props below are ignored and never reach the DOM. An icon reads the registration when it mounts,
so icons mounted earlier stay static: import it in your entry module, next to `createRoot`.
The entry is marked `"use client"`. With React Server Components, import it from a client
component; icons rendered by server components stay static markup, and effects run in client
components only. The engine itself (`@opensymbols/animate`, no `/react`) has no React and can be
imported anywhere.

Registering adds a small cost to every icon mounted afterwards, even one without effect props:
each runs the effects hook (a few refs and effects, idle until an effect plays).

The public API of `@opensymbols/animate/react` is the registration (the import itself),
`<Replace>`, and the types `EffectProps`, `SymbolHandle` and `ReplaceProps`. Its other exports
(`renderFrame`, `drawingOf`, `toSpec`, `DrawingKey`) are internal, for the demo's timeline, and
may change without notice.

The props, on every icon:

| prop | |
|---|---|
| `effect` | the effect, `{ kind, ...options }`: what `trigger`, `active` and `effectRef.play` play; `visible` uses its options when it is `appear` or `disappear` |
| `trigger` | discrete: every change of this value plays `effect` once (not the first render) |
| `active` | indefinite: while true, `effect` runs continuously; when it turns false, the current cycle finishes, then the icon rests |
| `visible` | transition: `false` plays Disappear and keeps the icon mounted but hidden (`visibility: hidden`, `aria-hidden`); `true` plays Appear |
| `effectRef` | a ref that receives `{ play(effect), stop() }`; `ref` stays the `<svg>` element |

```tsx
import { useRef } from "react";
import type { SymbolHandle } from "@opensymbols/animate/react";

<Bell effect={{ kind: "bounce", direction: "down" }} trigger={count} />
<Wifi effect={{ kind: "pulse" }} active={searching} />
<Wifi effect={{ kind: "appear", byLayer: false }} visible={online} />

const bell = useRef<SymbolHandle>(null);
<Bell effectRef={bell} />
bell.current?.play({ kind: "wiggle", repeat: "continuous" }); // later: bell.current?.stop()
```

Every effect takes `speed` (higher is faster, default 1) and `byLayer` (default `true`: the
motion groups move one after another; `false` moves the symbol as one). The other options, by
kind:

| `kind` | options | continuous form |
|---|---|---|
| `appear`, `disappear` | `direction`: `"up"` or `"down"` | no |
| `bounce` | `direction`: `"up"` or `"down"` | yes |
| `pulse` | | yes |
| `breathe` | `breathePlain`: scale only, no pulse in opacity | yes |
| `wiggle` | | yes |
| `rotate` | `rotateDirection`: `"clockwise"` or `"counterClockwise"` (default: the symbol's own) | yes |
| `scale` | `direction`: `"up"` or `"down"` | no |
| `draw` | `reversed` (Draw Off), `drawIndividually` (each layer in turn), `drawReversedOrder` (Draw Off only: retract, groups in reverse order) | no |
| `variableColor` | `fill`, `reversing`, `inactive`, `variableValue`, see below | yes |

A kind with a continuous form also takes `repeat: "once" | "continuous"`, which only
`effectRef.play` reads: `active` always runs continuously and `trigger` always plays once. The
types are a union on `kind`, so an option on a kind that does not take it is a type error.

Variable Color lights the layers that have a variable-colour threshold in the order of their
thresholds, lowest first. Its options:

| option | |
|---|---|
| `fill` | `"cumulative"` (default): each layer lights in turn and stays lit until the cycle ends; `"iterative"`: one layer at a time, each dimming as the next lights |
| `reversing` | `true`: after reaching the last layer, run back down to the first (default `false`) |
| `inactive` | the layers not lit: `"dim"` (default) or `"hide"` |
| `variableValue` | 0 to 1: instead of animating, hold a still frame at this value, the same look as the `variableValue` prop; `fill`, `reversing`, `inactive`, `speed` and `repeat` then do nothing |

A symbol without thresholds animates as a whole: no layer dims at the start, the whole symbol
dims to the inactive alpha and back each cycle (with `inactive: "hide"` it disappears and
comes back), and it snaps back to full at the end. Played once, the effect dims the
inactive layers, runs one cycle and returns to the plain symbol; continuously, it repeats the
cycle until `active` turns false or `stop()` is called, then finishes the cycle and returns to
the plain symbol. `byLayer` does nothing to it.

```tsx
<Wifi effect={{ kind: "variableColor", fill: "iterative", reversing: true }} active={searching} />
<SpeakerWave3 effect={{ kind: "variableColor", variableValue: volume }} active />
```

`Replace` swaps one symbol for another:

```tsx
import { Replace } from "@opensymbols/animate/react";
import PlayFill from "opensymbols-local/PlayFill";
import PauseFill from "opensymbols-local/PauseFill";

<Replace from={PlayFill} to={PauseFill} show={playing ? "to" : "from"} style="downUp" magic size={32} />
```

Both icons stay mounted, stacked; a change of `show` plays the Replace from the shown one to the
other. `style` is `"downUp"` (default), `"upUp"`, `"offUp"` or `"plain"`; `magic` animates a
slash or badge difference in place (Magic Replace) and falls back to the plain Replace when
the two symbols differ otherwise. It also takes `speed`, `byLayer` and the icon props, which go
to both icons.

Under `prefers-reduced-motion: reduce` (read when an effect starts) every effect jumps to its
end state: a once effect shows its last frame, a continuous one stays at rest, Disappear hides
at once and Replace swaps at once.

What is approximate or missing:

- Variable Color's defaults (cumulative, not reversing, dimmed) are those of Apple's renderer
  with no option set; which options SwiftUI's `.variableColor` passes by default is not known.
- Stopping is inferred: `stop()` and `active` turning false let each motion group finish its
  current cycle on its own delayed clock, then that group rests. Bounce, whose loop does not
  end at rest, plays its outro from the cycle end to settle; when Apple starts that outro is
  not known. `stop()` does nothing to a
  once effect, which runs out as it is.
- `active` on a kind without a loop (`draw`, `appear`, `disappear`, `scale`, and
  `variableColor` with a `variableValue`) plays it once, and `active` turning false does nothing to it. `scale` scales once and holds
  its end state.
- Timing, curves and stagger come from the format notes in `Docs/format/07`; where those mark a
  value as inferred, so is the motion.

## Preview your package

`opensymbols demo` serves a small browser app that lists the symbols of a generated package
and renders them with the runtime. It reads the package from disk and sends
nothing anywhere.

```sh
opensymbols demo --package ./my-icons
# OpenSymbols demo: http://127.0.0.1:4173/
```

Open the URL; stop with Ctrl+C. From a checkout of this repository, after `pnpm build`, run
`node packages/cli/dist/main.js demo --package ./my-icons`.

- `--package DIR` (required): a directory written by `generate`. The command exits with
  status 2 when `DIR/index.json` is missing, is not a package index, or comes from a newer
  format than this CLI knows.
- `--port N` (default 4173): exits with status 2 when the port is taken.
- `--host ADDR` (default 127.0.0.1): the address to listen on.
- `--open`: also open the URL in your default browser.

Under WSL2's default NAT networking, a browser or tool inside WSL cannot reach a server bound
to Windows' `127.0.0.1`. Start the demo with `--host 0.0.0.0` and, from WSL, open the Windows
host's IP address. The server then listens on all interfaces, so anyone on your network can
open the page and read the package. Use it only on a network you trust.

To try the demo without a catalog, write a synthetic package of geometric shapes (no Apple
data) and preview it:

```sh
node scripts/synthetic-package.mjs --out synthetic-demo --count 200
node packages/cli/dist/main.js demo --package synthetic-demo
```

The package holds Apple's drawings when it comes from your catalog: do not expose it on a
public address.

## License

The tooling is MIT licensed. The symbols themselves are Apple's and remain under Apple's license; you are responsible for using generated output in line with those terms.
