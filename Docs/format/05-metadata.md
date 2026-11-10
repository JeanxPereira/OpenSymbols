# 05 — Metadata: the bundle files, the app files, and how a name is resolved

The geometry is half the system. The other half is a set of plain data files that decide
which drawing a name gets, what it is called, where it is listed and what its colours are.
Measurements are on `26A5416b` (bundles) and on the SF Symbols app 8.0 (135), build
`8A18` (app files).

## 1. File formats

### 1.1 Binary property lists

`[CAR]` Every metadata file in both CoreGlyphs bundles is a **binary** property list
(`bplist00`), the `.strings` files included. They are neither compressed nor encrypted.
`[BIN] SFSymbols.framework 26A5416b` carries the machinery to ship them compressed and
encrypted (`DirectoryCompressor`, `DirectoryDecompressor`, an empty `SFSymbols.Crypton`
type, imports of `AACompressionOutputStreamOpen` / `AADecompressionInputStreamOpen`); on
this build it is not used.

`[INF]` `bplist00` is Apple's published binary plist format; the summary below is what a
reader of these files needs, and every bundle file parses under it `[CAR]`:

```
"bplist00"                                   8-byte header
objects …
offset table                                 numObjects × offsetIntSize bytes, big-endian
trailer (last 32 bytes):
    u8[5] unused, u8 sortVersion
    u8  offsetIntSize                        1..8
    u8  objectRefSize                        1..8
    u64 numObjects                           big-endian
    u64 topObject
    u64 offsetTableOffset
```

Each object starts with a marker byte, high nibble = type, low nibble = size or count
(`0xF` = the count follows as an int object):

| marker | object |
|---|---|
| `0x00` / `0x08` / `0x09` | null / false / true |
| `0x1n` | int, `2^n` bytes, big-endian |
| `0x2n` | real, `2^n` bytes (4 or 8), big-endian |
| `0x33` | date, 8-byte big-endian double |
| `0x4n` | data, `n` bytes |
| `0x5n` | ASCII string, `n` bytes |
| `0x6n` | UTF-16BE string, `n` code units |
| `0x8n` | UID, `n+1` bytes |
| `0xAn` / `0xCn` | array / set of `n` object refs |
| `0xDn` | dict: `n` key refs, then `n` value refs; keys are strings |

`[INF]` Guard every count, offset and reference against the file's size before using it;
reject cycles and duplicate dict keys.

`[INF]` The reader rejects `null` (`0x00`) and UID (`0x8n`) objects with an error naming the
marker. Neither occurs in these files `[CAR]`, and the model has no place for them: a new
build that starts using them fails loudly rather than being read as something else.

### 1.2 XML property lists

`[CAR]` The app's own metadata files are **XML** plists (`<?xml … <plist>`). `[INF]` A reader
dispatches on the first bytes: `bplist00` → binary, otherwise XML. Both yield the same
values.

### 1.3 Required and optional

`[INF]` `name_availability.plist` is required: without it a bundle has no notion of which
names are real. Every other bundle file is optional and an absent file leaves its data
empty — the private bundle genuinely lacks several of them `[CAR]` (§2.1). Every app file is
optional. A file that is **present** and does not parse is an error, never an empty result.

## 2. The bundle files

### 2.1 Inventory

`[CAR]` Beside each `Assets.car` (paths in [01](01-bom-and-car.md) §1.1):

| file | public | private | shape |
|---|---|---|---|
| `name_availability.plist` | 320 KB, 9,524 symbols | 61 KB | §2.2 |
| `name_aliases.strings` | 76 KB | 11 KB | dict string → string |
| `nofill_to_fill.strings` | 175 KB | 24 KB | dict string → string |
| `categories.plist` | 1.2 KB, 32 categories | — | array of dicts |
| `symbol_categories.plist` | 331 KB | 54 KB | dict string → array of strings |
| `symbol_order.plist` | 266 KB, 8,526 names | 52 KB | array of strings |
| `symbol_search.plist` | 150 KB | 18 KB | dict string → array of strings |
| `legacy_flippable.plist` | 2.2 KB, 75 names | — | array of strings |
| `symbol_restrictions.strings` | 38 KB | — | dict string → string |
| `semantic_to_descriptive_name.strings` | present (size not measured) | not measured | dict string → string |
| `container_recipes.plist` | — | 134 KB | not needed to decode symbols |

### 2.2 `name_availability.plist`

`[CAR]` A dict with two keys:

```
symbols           dict   name → year key                ("2019", "2023.1", …)
year_to_release   dict   year key → dict platform → version
```

```
year_to_release["2025"] = {iOS: 26.0, macOS: 26.0, tvOS: 26.0, visionOS: 26.0, watchOS: 26.0}
year_to_release["2026"] = {iOS: 27.0, macOS: 27.0, tvOS: 27.0, visionOS: 27.0, watchOS: 27.0}
```

`[BIN] SFSymbols.framework 26A5416b` The file matches the framework's
`NameAvailabilityPlist` type one to one (`symbols: [String: String]`,
`year_to_release: [String: [String: String]]`).

`[CAR]` Public symbols by first year: 2019 1,661 · 2020 1,070 · 2021 840 · 2022 932 ·
2023 1,000 · 2024 1,597 · 2025 616 · 2026 340, plus point releases (`2019.1`,
`2020.1`–`.2`, `2021.1`–`.3`, `2022.1`–`.2`, `2023.1`–`.4`, `2024.1`–`.4`, `2025.1`).
The 340 symbols of year 2026 first ship in macOS 27.0 — a cheap check that a catalog is the
build it claims to be.

### 2.3 `name_aliases.strings`

`[CAR]` Dict **alias → modern name**. `[BIN] SFSymbols.framework 26A5416b` Aliases are
first-class and permanent: the framework logs "Client requested a temporary SFSymbol alias
'%@' and should migrate to the latest name '%@'" and keeps resolving the old name. The
inverse (modern → aliases) is derived, not a file.

Apple does not redraw a symbol under its old name; it adds a new name (`siri.gen1` /
`siri.gen2`, `airpods.pro.gen1` / `airpods.pro.gen3`), and the old name keeps its drawing
`[CAR]`.

### 2.4 `nofill_to_fill.strings`

`[CAR]` Dict string → string between a symbol's outline and filled forms. `[INF]` Key is the
outline name, value the `.fill` name, as the file name says; the direction was not checked
entry by entry.

### 2.5 `categories.plist` (bundle)

`[CAR]` An array of 32 dicts, each with string `key` and string `icon` (a symbol name). The
bundle's copy has **no** `label`; the human titles are in the app's copy (§3.2).

### 2.6 `symbol_categories.plist`

`[CAR]` Dict symbol name → array of category keys.

### 2.7 `symbol_order.plist`

`[CAR]` Array of symbol names: the browsing order (8,526 public names).

### 2.8 `symbol_search.plist`

`[CAR]` Dict symbol name → array of search terms.

### 2.9 `legacy_flippable.plist`

`[CAR]` Array of 75 symbol names. `[OBS]` What flipping behaviour do they keep? The name
suggests legacy right-to-left mirroring; not read.

### 2.10 `symbol_restrictions.strings`

`[CAR]` Dict symbol name → usage-restriction text (the notes about trademarked symbols that
the app shows).

### 2.11 `semantic_to_descriptive_name.strings`

`[CAR]` Dict string → string. `[OBS]` What do the keys and values denote? The file name says
semantic name → descriptive name; nothing here depends on it.

## 3. The app files

### 3.1 Where they are

`[CAR]` The SF Symbols app carries metadata the bundles lack, in
`SF Symbols.app/Contents/Resources/Metadata/` (and, for the palette,
`SF Symbols.app/Contents/Frameworks/SFSymbolsShared.framework/Versions/A/Resources/`).

### 3.2 `categories.plist` (app)

`[CAR]` XML. The same 32 `key` / `icon` entries as the bundle's, each with a string `label`
(`"Privacy & Security"`). Join onto the bundle's categories by `key`.

### 3.3 `base_symbols_map.json`

`[CAR]` A JSON object: base symbol name → array of variant names, in the file's order. 1,812
bases, 3,870 variants (`0.circle` → `[0.circle.fill]`). No variant is itself a base and no
variant has two bases: the relation is a forest of depth one. `[INF]` A variant listed
under two bases is an error, not a choice. `[CAR]` 45 of the 1,812 bases are not in the
public `26A5416b` catalog: the map and the catalog are separate artefacts.

### 3.4 `layerset_availability.plist`

`[CAR]` XML. A dict with two keys:

```
symbols           dict   name → dict { "hierarchical"?: year key, "multicolor"?: year key }
year_to_release   dict   year key → dict platform → version      (as in §2.2)
```

6,593 symbols; either inner key may be absent. There is **no** `monochrome` or `palette`
key: every symbol has those two modes. `[BIN] SFSymbols.framework 26A5416b` The framework
types this as `LayerSetAvailability.LayerSets { multicolor: String?, hierarchical: String? }`.

### 3.5 `colors-26.csv`

`[CAR]` In `SFSymbolsShared.framework/Versions/A/Resources/`: one header line and 20 data
rows, 17 columns. The header, in order:

| # | column | holds |
|---:|---|---|
| 1 | `Color Name` | short name — `red` … `quinary` |
| 2 | `Symbol App Ready` | `TRUE` / `FALSE` |
| 3–5 | `Light Primary`, `Light Secondary`, `Light Tertiary` | percentages |
| 6–8 | `Dark Primary`, `Dark Secondary`, `Dark Tertiary` | percentages |
| 9 | `macOS Color Name` | `systemRedColor`, `labelColor`, … |
| 10–13 | `Light Standard`, `Light Vibrant Standard`, `Dark Standard`, `Dark Vibrant Standard` | colour cells |
| 14–17 | the same four, `Increased Contrast` | colour cells |

`[OBS]` The column names of 10–17 were not checked character by character against the
header line of `26A5416b`; a reader confirms them against the real header line before
relying on them.

**Column 9 is the join key.** `[CAR]` Its values are exactly the multicolor colour names the
style block emits (`.multicolor-N:systemRedColor`, [04](04-style-block.md) §2.2).

What a parser must handle `[CAR]`:

1. **A colour cell is one quoted field holding the whole tuple** — `"255, 56, 60"` —
   decimal components separated by commas *inside* the quotes. Splitting the line on
   every comma destroys the file; parse CSV quoting.
2. **A cell may carry a fourth component, an alpha percentage.** Every label row does:
   `labelColor`'s Light Standard is `"0, 0, 0, 85"`, `secondaryLabelColor`'s `"0, 0, 0, 50"`,
   down to `quinaryLabelColor`'s `"0, 0, 0, 5"`. One alpha is fractional: `quinary`'s Dark
   Standard is `"0, 0, 0, 1.5"`.
3. **Empty percentages.** The label rows `primary` … `quatenary` have empty Light
   percentages (columns 3–5) and real Dark ones (6–8); `quinary` is empty across 3–8. Only
   the fifteen hue rows carry both halves.
4. **`quinary`** has `Symbol App Ready = FALSE` and two empty colour cells (Light Vibrant
   Increased Contrast, Dark Vibrant Increased Contrast). It is the row this revision added
   over the previous `colors.csv` (19 rows).
5. **A typo in the data.** `gray`'s Light Vibrant Increased Contrast reads `"97, 97 101"`,
   a missing comma. Silently reading two components gives grey a wrong colour in one
   appearance; the policy is in §3.6. Column 1 also misspells `quatenary`, but column 9
   reads `quaternaryLabelColor`, so the join is unaffected.

**The hierarchy levels**, by column, over the rows that carry a value `[CAR]`:

| column | rows with a value | dominant | exceptions |
|---|---:|---:|---|
| Light Primary | 15 | 100 | none |
| Light Secondary | 15 | 50 | none |
| Light Tertiary | 15 | 18 | `yellow` = 20 |
| Dark Primary | 19 | 100 | none |
| Dark Secondary | 19 | 50 | none |
| Dark Tertiary | 19 | 25 | `red` = 20, `pink` = 20 |

So tertiary is 18 % in light and 25 % in dark, per colour, not one constant. **The label
rows' alphas are a separate ladder** (85, 50, …): they are not the hierarchy percentages,
and a reader must not substitute one for the other.

`[OBS]` What selects a row's percentages for a hierarchical drawing — the tint's own colour
row? The file does not say.

`[CAR]` The same directory also holds `SymbolVariantScripts.csv`: 186 rows of
`Script,Extension` (Afar → `aa`, Arabic → `ar`, Hindi → `hi`), the vocabulary behind the
name-suffix localization of §4.3.

The RGB values are Apple's data; they are read from the user's copy, never stored.

### 3.6 From `colors-26.csv` to CSS colours

The model exposes the palette as two maps, `light` and `dark`, from macOS colour name to a
CSS colour string. The rules below are the model's; each is `[INF]` unless sealed otherwise.

**Columns.** Locate columns by header text, not by position: split the header line with CSV
quoting, trim each cell, drop a leading UTF-8 byte-order mark. Three are required:

| map | key | value |
|---|---|---|
| both | `macOS Color Name` (expected position 9) | — |
| `light` | — | `Light Standard` (expected position 10) |
| `dark` | — | `Dark Standard` (expected position 12) |

If any of the three is missing, the file is rejected with an error that lists the header
cells it did contain. Why these two: they are the plain appearance colours; the Vibrant and
Increased Contrast columns are refinements for vibrant backgrounds and the accessibility
setting, which the model does not expose. `[OBS]` Their exact spelling is the one in the
table of §3.5, not re-checked against the file; locating by text means a reordered file still reads correctly and a renamed column fails
loudly instead of silently reading the wrong column.

**Rows.** Each data line is split with CSV quoting (a quoted field may contain commas).
Blank lines are skipped. The key is the trimmed `macOS Color Name`; a row with an empty key
is an error. A duplicate key is an error.

**A colour cell → CSS.** The cell text is split on `,` and each part trimmed. There must be
3 or 4 parts, each a finite decimal number. The first three are red, green and blue in
`0 … 255`; the optional fourth is an alpha **percentage** in `0 … 100` (`[CAR]` `85`, and the
fractional `1.5`). Then:

```
channel(v)   = round(v), as 2 lowercase hex digits         (v is already 0..255)
alphaByte(p) = round(p · 255 / 100), as 2 lowercase hex digits
css          = "#" + channel(r) + channel(g) + channel(b)
               + (p present and p < 100 ? alphaByte(p) : "")
```

`round` is round-half-up (`floor(x + 0.5)`). Examples: `"255, 56, 60"` → `#ff383c`;
`"0, 0, 0, 85"` → `#000000d9` (85 · 2.55 = 216.75 → 217); `"0, 0, 0, 1.5"` →
`#00000004` (3.825 → 4); `"0, 0, 0, 100"` → `#000000`. A fourth component equal to 100 adds
no alpha byte, so a fully opaque colour always has the short form.

**Empty and malformed cells.** In the two required colour columns, an empty cell or a cell
that breaks the rules above (wrong part count, a part that is not a number, a value out of
range) is an **error naming the row, the column and the text**. Reason: these are the base
colours of their appearance; there is nothing to fall back to, and a row silently missing
would render as the tint and pass for a correct drawing. `[CAR]` On the reference file
neither column has an empty or malformed cell: the empty cells are `quinary`'s two Vibrant
Increased Contrast cells, and the typo `"97, 97 101"` is in `gray`'s Light Vibrant Increased
Contrast — all in columns the model does not read, so they are ignored. A reader that
later exposes those columns drops a malformed cell with a warning naming it and falls back
to the same appearance's Standard cell, rather than guessing the missing comma: repairing
data it does not understand is how a reader renders a wrong colour confidently.

**Percentage columns** (3–8) are not part of the palette maps; their levels are summarised
in §3.5.

## 4. Resolving a name to a rendition

### 4.1 The axes

`[CAR]` Of the rendition key's tokens ([01](01-bom-and-car.md) §3.3), a resolver chooses
along five; every other token is fixed on vector renditions:

| token | axis | values on vector renditions |
|---:|---|---|
| 17 | Identifier | from `FACETKEYS` (§4.2) |
| 26 | GlyphWeight | 1 Ultralight, 4 Regular, 9 Black — always all three |
| 13 | Localization | 0, or a `LOCALIZATIONKEYS` id (§4.3) |
| 4 | Direction | 0; 4 = left-to-right only; 5 = right-to-left only ([01](01-bom-and-car.md) §5.3) |
| 7 | Appearance | 0, or an `APPEARANCEKEYS` id, on 160 identifiers |

No identifier varies on both Direction and Appearance.

### 4.2 Name → identifier

1. `[CAR]` Look the name up in its bundle's `FACETKEYS`.
2. `[BIN] SFSymbols.framework 26A5416b` If absent, follow `name_aliases.strings`
   (alias → modern) and look the modern name up. `[INF]` Public bundle first, then private.

`[INF]` A name present in both bundles' `FACETKEYS` resolves to the public one.

### 4.3 Localization: two mechanisms

`[CAR]` Both coexist and a resolver tries them in this order:

1. **Token 13** on the base name: a rendition whose Localization is the language's
   `LOCALIZATIONKEYS` id.
2. **A suffixed facet**: a separate `FACETKEYS` entry `<name>.<suffix>` (`0.circle.ar`,
   `questionmark.hi`) whose own renditions carry Localization 0.

If neither exists, the base drawing (Localization 0) is used.

`[CAR]` A facet is another symbol's localized or right-to-left variant when it is
`<stem>.<suffix>`, `<stem>` is itself a symbol, and the suffix is `rtl` or one of its
bundle's `LOCALIZATIONKEYS` tags. The tags are BCP-47 and one carries a script subtag
(`zh-Hans`) where facet names carry the language alone (`character.book.closed.fill.zh`),
so a two-letter suffix also matches with `-Hans` or `-Hant` appended. Under this rule the
public bundle has **1,317** such facets; without the script rule, 27 `.zh` facets are missed.

**In a generated package** (the model's reading):

- `[INF]` Each localized drawing is stored in its base symbol's `locales`, keyed by the
  catalog's BCP-47 tag (`ar`, `hi`, `zh-Hans`), each tag holding its own variants keyed like
  the base symbol's (`a<appearance>d<direction>`). Per tag, the token-13 renditions of the
  base name come first; the `<name>.<suffix>` facet fills a tag only where they are absent,
  the order of the two mechanisms above.
- `[INF]` A `zh` facet is stored under `zh-Hans` and `zh-Hant` when the bundle's
  `LOCALIZATIONKEYS` tags carry those, else under `zh`.
- `[INF]` A `<name>.rtl` facet becomes its base symbol's Direction 5 variant
  (`a<appearance>d5`) when the base symbol has none of its own; it is then the drawing a
  right-to-left request picks (§4.4). `[CAR]` The public bundle has 132 `.rtl` facets; on
  `26A5416b` every one of their base symbols already has its own Direction 5, so none of them
  adds a drawing. Likewise every language facet repeats a Localization rendition of its base,
  so the 1,615 localized drawings of a generated package all come from Localization renditions.
- `[INF]` A localized or right-to-left facet is not a symbol of its own in the package:
  `index.json` lists it with the base symbol and the locale or direction it became.
- `[INF]` The runtime resolves a requested locale in steps: the exact tag (`zh-Hant`), then
  its shorter prefixes and its language subtag (`zh-Hant-TW` → `zh-Hant`, `ar-EG` → `ar`), then
  the first stored tag of that language in sorted order (`zh` → `zh-Hans`), then the base drawing. Within the
  chosen set, Direction and Appearance are chosen as in §4.4.

### 4.4 Choosing among Direction and Appearance

**The Direction set.** `[CAR]` A facet's *Direction set* is the set of Direction values on
its vector renditions at Localization 0, the only ones a pick reads. Public facets have one
of three sets ([01](01-bom-and-car.md) §5.3): `{0}` 7,696, `{5}` 696, `{4, 5}` 134. Counted
over every localization, 7 of the 134 would read `{0, 4, 5}`, but their Direction 0 exists
only on a localized rendition and cannot be picked.

**Default selection.** `[INF]` When the caller does not ask for a Direction or Appearance,
take the rendition with the **lowest (Direction, Appearance) pair** among those matching
(Identifier, GlyphWeight, Localization). That gives Direction 0 when the set has 0, else 4
(the left-to-right artwork of a true pair), else 5 (a `{5}`-only facet's only artwork). When
the caller fixes one or both, filter on them first; no match is an error naming the symbol
and the key. Why:

- `[CAR]` Pinning Direction 0 makes the 696 `{5}`-only public facets (and the 134 `{4, 5}`
  ones) undrawable, though each has exactly one artwork per direction it is shown in.
- `[INF]` Choosing the first match would make the answer depend on `RENDITIONS` tree order,
  which nothing guarantees. `[CAR]` No two vector renditions on `26A5416b` share the full
  (Identifier, GlyphWeight, Localization, Direction, Appearance) tuple. `[INF]` So two that
  do are an error naming the symbol and the tuple, not a choice: a new build where the five
  axes no longer identify one artwork must surface.

**Has a direction variant.** `[INF]` A facet has a direction variant **iff its Direction set
contains both 4 and 5** (134 public facets). A `{5}`-only facet has **no** variant: its one
artwork is drawn in both directions. A symbol entry's `variants.direction` lists the
Direction values a caller can choose between: the sorted set when the facet has a direction
variant (`[4, 5]` on `26A5416b`), else `[]`. For a right-to-left request, pick 5 when the
facet has a variant; otherwise use the default. `[INF]` In a generated package a right-to-left
request takes Direction 5 whenever the set stores one, which also covers a base that received
its `.rtl` facet as Direction 5 (§4.3). For a left-to-right request, pick 4 when the
facet has a variant; otherwise the default.

**Appearance.** `[INF]` Likewise, `variants.appearance` is the sorted set of Appearance values
when it has more than one member, else `[]`; the default is the lowest value.

### 4.5 What the framework's own row looks like

`[BIN] SFSymbols.framework 26A5416b` (`__swift5_fieldmd`) The framework's unit is a CSV row,
`SystemSymbolCSVRow` — `privateScalar`, `name`, `mirrorForRTL`, `locale`,
`publicScalars`, `functions`, `accessLevel`, `useRestrictionText`, `defaultRenderingMode`,
`additionalColumns` — with closed enums

```
RenderingMode          monochrome | hierarchical | multicolor | palette
AccessLevel            public | publicNonModifiable | private | confidential
Availability.Platform  sfSymbols | macOS | macCatalyst | iOS | watchOS | tvOS | visionOS
```

That CSV is compiled into the framework and is not one of the files above; it is listed so
the four rendering modes have their source.
