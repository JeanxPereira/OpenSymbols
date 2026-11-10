# 01 — The container: BOM store and asset catalog

How `Assets.car` is laid out, and how a symbol name becomes the bytes of a vector
drawing. Seals are explained in [README](README.md). Unless a section says otherwise,
measurements are over the catalogs of macOS build `26A5416b` (CoreUI 1010), and `[BIN]`
facts were read from `CoreUI` of the same build.

## 1. Where the catalogs are

### 1.1 The two bundles

`[CAR]` The symbols ship in two data bundles inside `SFSymbols.framework`:

```
/System/Library/PrivateFrameworks/SFSymbols.framework/Versions/A/Resources/
    CoreGlyphs.bundle/Contents/Resources/Assets.car          public,  8,527 facets
    CoreGlyphsPrivate.bundle/Contents/Resources/Assets.car   private, 1,653 facets
```

The metadata files beside each `Assets.car` are described in
[05-metadata.md](05-metadata.md). `/System/Library/CoreServices/CoreGlyphs.bundle` is a
symlink to the first bundle, not a second copy.

### 1.2 It is not a font

`[CAR]` No system font carries the symbols as glyphs: `SFNS.ttf` of `26A5416b` has 2,954
glyphs and 13 codepoints in the private use area. Each symbol does have a private-use
scalar, but it is an identifier in the framework's metadata store, not a glyph index. The
geometry lives only in `Assets.car`.

## 2. BOM store

`Assets.car` is a BOM store, the NeXTSTEP archive format.

### 2.1 The endianness rule

`[CAR]` Two byte orders coexist in one file:

- the **BOM container** — header, block table, variables, tree blocks and tree nodes —
  is **big-endian**;
- the **CoreUI structures** stored inside blocks — `CARHEADER`, `KEYFORMAT`, rendition
  keys, `FACETKEYS` and `LOCALIZATIONKEYS` values, `csiheader`, the `DWAR` wrapper — are
  **little-endian**.

A four-character tag tells which: `CTAR` stored little-endian reads back as `RATC`.
Reading a container field little-endian gives offsets that look almost plausible, so a
mistake here does not crash; it decodes nonsense.

### 2.2 Header

`[CAR]` At offset 0, all fields big-endian:

| offset | field | notes |
|---:|---|---|
| 0 | `char magic[8]` | `BOMStore` |
| 8 | `u32 version` | 1 |
| 12 | `u32 numberOfBlocks` | 342,113 in the public catalog |
| 16 | `u32 indexOffset` | the block table |
| 20 | `u32 indexLength` | |
| 24 | `u32 varsOffset` | the variables (named blocks) |
| 28 | `u32 varsLength` | |

### 2.3 Block table

`[CAR]` At `indexOffset`: `u32 count`, then `count` entries of `(u32 address, u32 length)`,
big-endian. Block *i* is the byte range `[address, address + length)` of the file.

- `[INF]` The table's own `count` is authoritative; the header's `numberOfBlocks` need
  not equal it, and block lookups index the table.
- `[INF]` Block index 0 is reserved: it never names data, and a reference to block 0 is
  "no block".
- `[INF]` A `count` larger than the bytes after it can hold (`count * 8 > remaining`) is
  corrupt and must be rejected before anything is sized from it.

### 2.4 Variables (named blocks)

`[CAR]` At `varsOffset`: `u32 count`, then per entry `u32 blockIndex`, `u8 nameLength`,
`nameLength` bytes of name (no terminator). Big-endian.

The symbol catalogs name eight blocks:

```
APPEARANCEKEYS  BITMAPKEYS  CARHEADER  EXTENDED_METADATA
FACETKEYS       KEYFORMAT   LOCALIZATIONKEYS  RENDITIONS
```

`BITMAPKEYS` and `EXTENDED_METADATA` are not needed to decode symbols.

### 2.5 Tree blocks

`FACETKEYS`, `RENDITIONS`, `LOCALIZATIONKEYS` and `APPEARANCEKEYS` are B+trees. The named
block is the tree header. `[CAR]` Big-endian:

| offset | field |
|---:|---|
| 0 | `char magic[4]` = `tree` |
| 4 | `u32 version` |
| 8 | `u32 rootBlock` — block index of the root node |
| 12 | `u32 blockSize` |
| 16 | `u32 pathCount` |
| 20 | `u8` (unused by a reader) |

`[INF]` A `rootBlock` of 0 is a corrupt or absent tree, not an empty one.

### 2.6 Tree nodes

`[CAR]` Each node is a block, big-endian:

```
u16 isLeaf        non-zero for a leaf
u16 count
u32 forward       next leaf (0 = none)
u32 backward      previous leaf
(u32, u32)[count]
```

### 2.7 The pair trap

`[CAR]` The meaning of a pair depends on the node kind:

| node | first `u32` | second `u32` |
|---|---|---|
| internal | **child** node block | key block |
| leaf | **value** block | **key** block |

Reading a leaf's pair as `(key, value)`, or descending an internal node through the
second `u32`, makes `RENDITIONS` enumerate as empty — no error, just zero entries.

### 2.8 Walking a tree

`[CAR]` To enumerate every entry in key order:

1. Start at `rootBlock`. While the node is internal, go to the child named by the first
   `u32` of its **first** pair.
2. At the first leaf, emit each pair as `(key = block(second), value = block(first))`.
3. Follow `forward` to the next leaf; stop at 0.

`[INF]` Guard both phases against revisiting a node (a cycle in corrupt input). An
internal node with `count = 0` has no child to descend to and is corrupt. A leaf block
shorter than `12 + 8 * count` bytes is corrupt; stopping early would silently return a
partial tree.

## 3. The CoreUI blocks

### 3.1 `CARHEADER`

`[CAR]` Little-endian. On the public catalog it reads: tag `RATC`, CoreUI version 1010,
storage version 17, rendition count 157,938, followed by the version strings
`@(#)PROGRAM:CoreUI  PROJECT:CoreUI-1010` and `Xcode 27.0 (27A200c) via
AssetCatalogAgent-AssetRuntime`.

`[INF]` The CoreUI `carheader` layout, little-endian:

| offset | field | notes |
|---:|---|---|
| 0 | `char tag[4]` | `RATC` |
| 4 | `u32 coreuiVersion` | 1010 on the public catalog |
| 8 | `u32 storageVersion` | 17 |
| 12 | `u32 storageTimestamp` | not used |
| 16 | `u32 renditionCount` | 157,938 |
| 20 | `char mainVersionString[128]` | NUL-terminated; `@(#)PROGRAM:CoreUI  PROJECT:CoreUI-1010` |
| 148 | `char versionString[256]` | the Xcode string |

The layout is checked on every read: `mainVersionString` must contain
`CoreUI-<coreuiVersion>`. A block shorter than 148 bytes is malformed. Nothing in symbol
decoding depends on `CARHEADER`; a reader uses it only to fingerprint the catalog's build. So
a block that is absent, short or fails the check does not make the catalog unreadable: the
reader reports no header and a note naming the reason (both values, for a failed check), and
keeps decoding. The cost of the check is then only the fingerprint: a wrong layout is reported
as "no header", never as a wrong build, and a build with no header is never treated as the
validated one.

### 3.2 `KEYFORMAT`

`[CAR]` Little-endian:

```
u32 tag
u32 version
u32 count
u32 token[count]
```

A rendition key is `count` little-endian `u16` values, **in this token order**. The order
is per catalog: read it, never hard-code it. On `26A5416b` (both bundles):

```
[7, 13, 1, 2, 4, 17, 8, 9, 10, 14, 12, 19, 18, 25, 26, 27]
```

So `Identifier` (17) is key slot 5 and `GlyphWeight` (26) is key slot 14 on this build.
`[INF]` A catalog whose `KEYFORMAT` lacks token 17 cannot join names to renditions and is
rejected.

### 3.3 The attribute-name table

`[BIN] CoreUI 26A5416b` `_CUIThemeAttributeNameToString` (`0x18b529334`) indexes a
28-pointer table at `0x1e09e1b68`. Token → name:

| token | name | token | name | token | name | token | name |
|---:|---|---:|---|---:|---|---:|---|
| 1 | Element | 8 | Dimension1 | 15 | Idiom | 22 | MemoryClass |
| 2 | Part | 9 | Dimension2 | 16 | Subtype | 23 | GraphicsClass |
| 3 | Size | 10 | State | 17 | Identifier | 24 | DisplayGamut |
| 4 | Direction | 11 | Layer | 18 | PreviousValue | 25 | DeploymentTarget |
| 5 | Placeholder | 12 | Scale | 19 | PreviousState | 26 | GlyphWeight |
| 6 | Value | 13 | Localization | 20 | SizeClassHorizontal | 27 | GlyphSize |
| 7 | Appearance | 14 | PresentationState | 21 | SizeClassVertical | 28 | (MaxAttribute) |

The tokens that matter for symbols:

| token | name | values on vector renditions |
|---:|---|---|
| 4 | Direction | 0, 4 (left-to-right only) or 5 (right-to-left only) — §5.3 |
| 7 | Appearance | 0, or an id from `APPEARANCEKEYS` — §3.6 |
| 9 | Dimension2 | always 0 — §5.4 |
| 12 | Scale | 1 = @1x, 2 = @2x (measurement renditions) |
| 13 | Localization | 0 = base drawing, or an id from `LOCALIZATIONKEYS` — §3.5 |
| 17 | Identifier | the join key — §3.4 |
| 26 | GlyphWeight | 1, 4, 9 — §5.2 |
| 27 | GlyphSize | always 1 (Small) — §5.4 |

### 3.4 `FACETKEYS` — name to identifier

A tree (§2.5). `[CAR]` Key: the symbol name, ASCII, NUL-terminated or filling the block.
Value, little-endian:

```
u32 reserved          0
u16 attributeCount
(u16 token, u16 value)[attributeCount]
```

`[CAR]` Over the 8,527 public facets the value is 22 bytes with 4 attributes, except one
facet with 3. The tokens are always 1, 2, 17 and 25:

| token | name | value on `wifi` |
|---:|---|---:|
| 1 | Element | 85 |
| 2 | Part | 181 |
| 17 | Identifier | 23,604 |
| 25 | DeploymentTarget | 13 |

Only token 17 varies per symbol. **Token 17's `u16` is the join key**: the only link from
a name to its renditions. `[INF]` A facet without token 17 cannot be drawn; skip it and
count it, do not fail the catalog. If token 17 occurs twice, the first wins. `[INF]` Likewise
skipped and counted: a value shorter than 6 bytes, an attribute list shorter than its
`attributeCount` (truncated), and a second entry with a name already read (the first is
kept). None occurs on `26A5416b` (§6).

`[CAR]` A name can appear in both bundles' `FACETKEYS` (e.g. `_gradient.highlegibility`,
an internal facet). The two bundles are separate catalogs; identifiers are only
meaningful inside their own `Assets.car`.

### 3.5 `LOCALIZATIONKEYS`

A tree. `[CAR]` Key: a BCP-47 language tag (ASCII). Value: little-endian `u16`, the id that
rendition key token 13 carries. 28 entries on `26A5416b`:

| tag | id | tag | id | tag | id | tag | id |
|---|---:|---|---:|---|---:|---|---:|
| ar | 59797 | ur | 54185 | hi | 42419 | he | 29743 |
| ja | 29613 | zh-Hans | 44691 | zh-Hant | 15092 | ko | 14716 |
| th | 16222 | ru | 12105 | uk | 64770 | el | 339 |
| bg | 63979 | kk | 2040 | bn | 53394 | gu | 8638 |
| kn | 44315 | ml | 50523 | mni | 27859 | mr | 4001 |
| my | 58952 | or | 16547 | pa | 1715 | sat | 10807 |
| si | 45886 | ta | 26807 | te | 39483 | km | 8378 |

`[CAR]` Every vector rendition's token 13 is either 0 or one of these ids.

`[INF]` An entry whose value is shorter than two bytes carries no id: it is skipped and
counted (§6), here and in `APPEARANCEKEYS`.

### 3.6 `APPEARANCEKEYS`

`[CAR]` Rendition key token 7 (Appearance) takes values that match the ids this tree
publishes. `[INF]` Its shape is that of `LOCALIZATIONKEYS` (key: appearance name, value:
little-endian `u16` id); it was read by its ids, not by a byte map.

`[OBS]` What names does `APPEARANCEKEYS` hold on `26A5416b`, and which id is the dark
appearance? A resolver can select by the numeric value without knowing the name.

### 3.7 `RENDITIONS` — key

A tree. The key block is the rendition key: `KEYFORMAT.count` little-endian `u16` values in
`KEYFORMAT` order (§3.2). `[INF]` A key block shorter than that is a malformed record:
skip and count it.

### 3.8 `RENDITIONS` — value: the `csiheader`

`[CAR]` The value starts with a 184-byte `csiheader`, little-endian:

| offset | field | notes |
|---:|---|---|
| 0 | `char tag[4]` | `CTSI`, which reads `ISTC` when stored little-endian |
| 12 | `u32 width` | |
| 16 | `u32 height` | |
| 20 | `u32 scale` | |
| 24 | `u32 pixelFormat` | |
| 36 | `u16 layout` | §3.9 |
| 40 | `char name[128]` | NUL-padded |
| 168 | `u32 tlvLength` | length of the TLV section after the header |
| 172 | `u32 bitmapCount` | |
| 176 | `u32 reserved` | |
| 180 | `u32 renditionLength` | 0 = no payload |

`[OBS]` Bytes 4–11, 28–35 and 38–39 are not mapped; nothing below needs them.

`[INF]` A value shorter than 184 bytes is malformed. The tag decides the byte order of the
rest of the header: `ISTC` means little-endian; every symbol rendition measured is
little-endian.

**The payload does not start at 184.** `[CAR]` A TLV section of `tlvLength` bytes follows
the header, and the payload starts at **`184 + tlvLength`**. Ignoring the TLV section
reads its bytes as the payload tag.

The TLV section is a run of `(u32 type, u32 length, length bytes)` entries, little-endian.
`[INF]` A TLV section that does not parse cleanly (an entry whose length runs past the
section, or a `tlvLength` past the value) loses only the metrics: the rendition and its
payload, which starts at `184 + tlvLength` regardless, are kept, and the reader records a
note with the reason. Reason: the format does not promise a clean run on every rendition,
and a stricter parse would drop renditions that never needed the TLV. A rendition whose
payload genuinely starts past the value's end is still skipped (§6). A trailing fragment of
fewer than 8 bytes is padding. Type 1018 carries vector-glyph metrics; see
[06-drawing.md](06-drawing.md) §9.1. A 1018 entry shorter than 36 bytes is a note with a
reason too; the rendition is kept without metrics. Notes are counted apart from skipped
records (§6).

### 3.9 Layouts

`[CAR]` `layout` values seen on symbol catalogs, and one seen elsewhere:

| `layout` | meaning |
|---:|---|
| 1022 | vector — payload is a `DWAR` wrapper (§3.10) |
| 1003 | measurement slot — `renditionLength = 0`, no payload bytes at all |
| 9 | vector, in application catalogs — `DWAR` wrapping `%PDF`; not in CoreGlyphs |
| 1004 | raster — `MLEC` pixels; 2,791 public renditions named `ZZZZPackedAsset-*` |
| 12 | raster — `MLEC` pixels; the 2 renditions of `_gradient.highlegibility` |

`[INF]` Classify by `renditionLength` and payload tag, not by layout alone: a rendition
with `renditionLength = 0` has no payload, whatever its layout.

### 3.10 `DWAR` — the vector wrapper

`[CAR]` At `184 + tlvLength`, little-endian:

```
char tag[4]           'DWAR'
u32  zero
u32  payloadLength
u8   payload[payloadLength]
```

The payload's own magic says what it is:

- `BVG ` — Binary Vector Graphics, the symbol geometry: [02-bvg-document.md](02-bvg-document.md).
- `%PDF` — a literal PDF, used by application catalogs.

`[INF]` Check the magic; do not infer it from the layout. A payload tag other than `DWAR`
is not a vector drawing.

`[CAR]` Beside the vectors, the public catalog stores 2,793 renditions whose payload tag is
`MLEC` (`CELM` byte-reversed) instead of `DWAR`: pixels, pre-rendered bitmaps of the
symbols. All but two are layout 1004 and named `ZZZZPackedAsset-*`. They sit in the twelve key
slots of the measurement renditions of §4 (GlyphWeight 4, Dimension2 {0,1,2} × GlyphSize
{2,3} × Scale {1,2}; on `list.number`, twelve per Direction), with pixels where most
symbols have no payload at all. `[INF]` A reader
keeps them with no drawing and counts them apart: they are expected, not malformed records
(§6). A facet whose renditions are all `MLEC` has nothing to draw: `[CAR]` that is
`_gradient.highlegibility` (an internal facet, §3.4), the one public facet without a vector
rendition. It is in `FACETKEYS` and counts among the 8,527 facets, but it is not a symbol.

## 4. A symbol's renditions, by example

`[CAR]` `square.and.arrow.up` has 15 renditions:

| group | `layout` | payload | count | what varies |
|---|---:|---|---:|---|
| vector | 1022 | `DWAR` → `BVG ` | 3 | GlyphWeight ∈ {1, 4, 9} |
| measurement | 1003 | none | 12 | Dimension2 {0,1,2} × GlyphSize {2,3} × Scale {1,2} |

## 5. What the key axes mean

### 5.1 Counts

`[CAR]` Vector renditions on `26A5416b`: 31,029 public and 5,946 private, **36,975**
`BVG ` documents in all. These are the population every `[CAR]` count in docs 02–06
is taken over unless it says "public".

### 5.2 GlyphWeight (26): three masters

`[CAR]` Every symbol has exactly three vector renditions per (Localization, Direction,
Appearance) combination, with GlyphWeight 1, 4 and 9, and the three carry different
geometry:

```
wifi  GlyphWeight=1  viewBox 0 0 10.968744 7.959957
wifi  GlyphWeight=4  viewBox 0 0 11.30517  8.290035
wifi  GlyphWeight=9  viewBox 0 0 12.136713 9.020015
```

`[BIN] CoreUI 26A5416b` The weight enum is
`kCoreThemeVectorGlyphWeight{None, Ultralight, Thin, Light, Regular, Medium, Semibold,
Bold, Heavy, Black}`, so 1 = Ultralight, 4 = Regular, 9 = Black. The other six weights
are not stored; CoreUI interpolates them per point from the three masters
(`CUIVectorGlyphMutator`), and refuses masters whose point counts differ ("CoreUI:
Incompatible points when attempting to interpolate: Ultralight=%lu, Regular=%lu,
Black=%lu"). Points, not commands: the masters' commands differ, their points do not
([03](03-bvg-paths-and-numbers.md) §7).

`[OBS]` What are the interpolation scalars for the six intermediate weights?
(`+[CUIVectorGlyphMutator _interpolationData]`, not read.)

### 5.3 Direction (4) and Appearance (7)

**Direction (token 4).** `[BIN] SF Symbols app 8` The app's inspector describes the two
non-zero values: **4 = a variant that only appears in left-to-right locales**, **5 = a
variant that only appears in right-to-left locales**. 0 = no direction axis.

`[CAR]` Carrying a Direction value is not the same as having a direction *variant*.
Grouping every public facet by the **set** of Direction values its Localization 0 vector
renditions carry:

| Direction set | facets | example | masters | has a direction variant |
|---|---:|---|---:|---|
| `{0}` | 7,696 | `0.circle` | 3 | no |
| `{5}` | 696 | `airplane` | 3 | **no** — its only artwork is tagged 5 and serves both directions |
| `{4, 5}` | 134 | `airtag.radiowaves.forward` | 6 | yes — a true left-to-right / right-to-left pair |

`[CAR]` Over every localization, 7 of the 134 (`cart.badge.questionmark`, `list.number` and
five more) also carry Direction 0, but only on a localized rendition: `list.number` has
Direction 0 on its Arabic artwork (Localization 59797) and nowhere else. A resolver reads
Localization 0 ([05](05-metadata.md) §4.4), so for it 0 is not one of their directions.

So 134 public facets have a direction variant; a `{5}`-only facet has none, and a
resolver that pinned Direction 0 could not draw it at all. The resolver rule is in
[05-metadata.md](05-metadata.md) §4.4.

**Appearance (token 7).** `[CAR]` Appearance-specific artwork: 480 renditions across 160
identifiers. The artwork differs (`moonphase.waning.gibbous` is 301 bytes at Regular,
Appearance 0, and 323 bytes at Appearance 1).

`[CAR]` No identifier varies on both axes. In the public catalog, 202 identifiers carry
more than one (Direction, Appearance) combination: 134 by Direction, 68 by Appearance.
Each combination has its own three masters.

### 5.4 GlyphSize (27) and Dimension2 (9)

`[CAR]` Every vector rendition has GlyphSize = 1 (Small) and Dimension2 = 0: the masters
are drawn once, at Small. `[BIN] CoreUI 26A5416b` `kCoreThemeVectorGlyphSize{None,
Small, Medium, Large}`; Medium and Large are derived from the Small masters by a
transform (`+[CUIVectorGlyphMutator transformForGlyphSize:]`).

`[OBS]` What is that transform? Not read.

`[BIN] CoreUI 26A5416b` Dimension2 is a point-size class:
`___VectorGlyphDimension2ToPointSizeTableForMac` (`0x18b594f28`) is `[11.0, 13.0, 17.0]`
and the embedded table (`0x18b594f40`) is `[15.0, 17.0, 20.0]`. The twelve measurement
renditions per symbol are Dimension2 {0,1,2} × GlyphSize {2,3} × Scale {1,2}; Small has
none, consistent with Small being the master's own size. `[CAR]`

### 5.5 Localization (13)

`[CAR]` 388 public symbols have an `ar` drawing, 388 an `ur` one, 339 `hi`, down to 2
for `my` and `km`. A second, name-based localization mechanism coexists; both are in
[05-metadata.md](05-metadata.md) §4.3.

## 6. From a name to a `BVG ` document

```
"wifi"
  → FACETKEYS                  name → Identifier (token 17)
  → RENDITIONS                 key with that Identifier, GlyphWeight ∈ {1,4,9},
                               Localization, Direction, Appearance
  → csiheader                  skip 184 + tlvLength bytes
  → DWAR                       payloadLength bytes
  → 'BVG '                     doc 02
```

`[INF]` Robustness policy for a reader: a missing or unreadable tree (`FACETKEYS`,
`RENDITIONS`, `LOCALIZATIONKEYS`) fails the catalog; a malformed record inside a present
tree is skipped and counted, so one bad record does not hide the others. Zero records are
skipped on either `26A5416b` catalog `[CAR]`. `[INF]` The reader keeps the first 20 skipped
records with their tree, entry index and reason, so a non-zero count can be traced.
`[INF]` A rendition kept without metrics (§3.8) is not a skipped record and is not part of
that count; the reader keeps a separate count and the first 20 reasons. Nor is an `MLEC`
raster (§3.10): it is counted apart.
