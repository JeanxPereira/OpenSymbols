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

`--out` must be a new or empty directory, or the output of a previous `generate`, whose
`symbols/`, `chunks/` and index files are then replaced. Any other non-empty directory is
refused. The output:

```
my-icons/
  package.json         private, ESM, peer dependencies @opensymbols/react and react >= 19
  index.js, index.d.ts one named export per symbol, plus the legacy alias names
  index.json           the build fingerprint, the palette, every symbol's name, component,
                       aliases, categories, search terms, year, render modes and chunk; the
                       skipped symbols with their reasons; the localized facets (not generated)
  symbols/<Component>.js, .d.ts   one module per symbol
  chunks/<n>.json      the same symbol data, 200 symbols per file, for tools that load it raw
```

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
  /path/to/OpenSymbols/out/opensymbols-core-0.0.0.tgz \
  /path/to/OpenSymbols/out/opensymbols-react-0.0.0.tgz \
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

<Wifi size={32} weight="semibold" mode="hierarchical" color="#0a84ff" />
<HeartFill weight={7.5} mode="multicolor" layout="text" title="Favourite" />
```

The barrel works too (`import { Wifi, HeartFill } from "opensymbols-local"`), and production
bundles drop the icons you do not use: the package has `sideEffects: false` and every
`createIcon` call is marked `/*#__PURE__*/`. Dev servers do not tree-shake, though, and a
barrel import there loads every icon module. With Vite, keep the package out of the
dependency pre-bundling, `optimizeDeps: { exclude: ["opensymbols-local"] }` in
`vite.config`; with Next.js, list it in `experimental.optimizePackageImports` in
`next.config`, which rewrites barrel imports into deep ones. The `exports` map also exposes
`opensymbols-local/index.json` and `opensymbols-local/chunks/<n>.json`.

Component names are the symbol names in PascalCase (`heart.fill` → `HeartFill`; a name that
starts with a digit gets an `Sf` prefix). The props, all optional:

| prop | default | |
|---|---|---|
| `size` | `24` | the edge of the square in px (`layout="box"`), or the font size the icon is set to (`layout="text"`) |
| `weight` | `"regular"` | a weight name (`ultralight` … `black`) or a number from 1 (ultralight) to 9 (black) |
| `mode` | `"monochrome"` | `monochrome`, `hierarchical`, `multicolor` or `palette`; a mode the symbol does not have is drawn in monochrome |
| `color` | `"currentColor"` | the tint |
| `palette` | | the colours of `palette` mode, by layer role: primary, secondary, tertiary; the last one repeats, and with none the tint is used |
| `variableValue` | | 0 to 1: the symbol's variable-colour layers light up as the value passes each layer's threshold |
| `appearance` | `"light"` | `"light"` or `"dark"`: the symbol's dark variant when it has one, and the dark multicolor colours and hierarchy levels |
| `direction` | `"auto"` | `"ltr"`, `"rtl"` or `"auto"`: the right-to-left variant when the symbol has one; `auto` renders left-to-right, then follows the nearest `dir` attribute after mount |
| `layout` | `"box"` | `"box"` fits the icon, centred, in a `size` square that no weight changes; `"text"` sizes it to text of font size `size` and sets it on the baseline |
| `title` | | an accessible name; without it the icon is `aria-hidden` |

Other SVG props (`className`, `style`, `aria-*`, handlers) go to the `<svg>`.

When a render is not exact, the `<svg>` carries `data-approximate="true"` and
`data-approximations`, a space-separated list of reasons:

| reason | the render is not exact because |
|---|---|
| `weight` | the weight lies between two stored masters and is interpolated with a provisional (linear) table |
| `weight-unavailable` | the weight needs a master the package does not have (`--masters regular`): drawn at regular |
| `mode` | the symbol does not offer the requested `mode`: drawn in monochrome |
| `palette` | `multicolor` with stand-in colours (no `app/colors-26.csv`) |
| `variable-value` | a `variableValue` was applied: the dimmed look of inactive layers is approximated |
| `variable-draw` | the symbol's variable value draws its paths; a `variableValue` is ignored |
| `text-layout` | `layout="text"`: the scale and baseline rules are inferred, not decoded |
| `metrics` | `layout="text"` on a symbol without glyph metrics: sized like the box layout, with no baseline shift |
| `build` | the package was generated from a catalog that is not the validated build (below) |

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

## License

The tooling is MIT licensed. The symbols themselves are Apple's and remain under Apple's license; you are responsible for using generated output in line with those terms.
