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
are not stored. CoreUI computes every weight, the three stored ones included, from the
three masters (`CUIVectorGlyphMutator`), with one pair of scalars per (weight, glyph size).

**The scalar table.** `[BIN] CoreUI 26A5416b` `+[CUIVectorGlyphMutator _interpolationData]`
(0x18b4cd900) is a `dispatch_once` accessor: the table is built once in its block
(0x18b4cd938, size 0xb60) and cached in `_interpolationData.interpolationData`
(0x1e6440cf0). It has two levels. The outer key is a continuous glyph size (six keys), the
inner key a continuous weight (nine keys), and each value is a pair `(x, y)` of float64:
`x` is the **Ultralight** scalar and `y` the **Black** scalar (at size 1.0, Ultralight is
(1, 0), Black (0, 1) and Regular (0, 0)). `[INF]` The calls that build it
(`+[NSNumber numberWithDouble:]`, `+[NSValue valueWithPoint:]`,
`dictionaryWithObjects:forKeys:count:`) and the consumer's `-pointValue` are named from
their argument shapes: they go through dyld-cache stubs outside the image, so no selector at
a call site is read.

`[BIN] CoreUI 26A5416b` The keys are float64 constants:

| size key | symbol | address | value |
|---|---|---|---:|
| XXSmall | `_CUIVectorGlyphContinuousSizeXXSmall` | 0x18b58c610 | 0.2 |
| XSmall | `_CUIVectorGlyphContinuousSizeXSmall` | 0x18b58c618 | 0.5 |
| Small | `_CUIVectorGlyphContinuousSizeSmall` | 0x18b58c620 | 1.0 |
| Medium | `_CUIVectorGlyphContinuousSizeMedium` | 0x18b58c628 | 1.276 |
| Large | `_CUIVectorGlyphContinuousSizeLarge` | 0x18b58c630 | 1.647 |
| XLarge | `_CUIVectorGlyphContinuousSizeXLarge` | 0x18b58c638 | 2.0 |

| weight | symbol | address | value |
|---|---|---|---:|
| 1 Ultralight | `_CUIVectorGlyphContinuousWeightUltralight` | 0x18b58c640 | −0.8 |
| 2 Thin | `_CUIVectorGlyphContinuousWeightThin` | 0x18b58c648 | −0.6 |
| 3 Light | `_CUIVectorGlyphContinuousWeightLight` | 0x18b58c650 | −0.4 |
| 4 Regular | `_CUIVectorGlyphContinuousWeightRegular` | 0x18b58c658 | 0 |
| 5 Medium | `_CUIVectorGlyphContinuousWeightMedium` | 0x18b58c660 | 0.23 |
| 6 Semibold | `_CUIVectorGlyphContinuousWeightSemibold` | 0x18b58c668 | 0.3 |
| 7 Bold | `_CUIVectorGlyphContinuousWeightBold` | 0x18b58c670 | 0.4 |
| 8 Heavy | `_CUIVectorGlyphContinuousWeightHeavy` | 0x18b58c678 | 0.56 |
| 9 Black | `_CUIVectorGlyphContinuousWeightBlack` | 0x18b58c680 | 0.62 |

`[BIN]` The arrays: `_kCoreThemeContinuousGlyphInternalSizes` (0x18b58c688) is the six
sizes, `_kCoreThemeContinuousGlyphSizes` (0x18b58c6d0) is {1.0, 1.276, 1.647},
`_kCoreThemeDiscreteGlyphSizes` (0x18b58c6b8) is {1, 2, 3}, and
`_kCoreThemeContinuousGlyphWeights` (0x18b58c730) is the nine weights in order. `[INF]` The
weight keys are the NSFontWeight values.

`[BIN] CoreUI 26A5416b` The values are float64 constants (`qword_18B5926F8` …
`qword_18B592948`), except 0, 0.5 and 1.0, which the code builds from `MOVI`/`FMOV`
immediates. The table holds no float32; CoreUI computes in CGFloat (double). The
Ultralight scalar `x`:

| weight | 0.2 | 0.5 | 1.0 | 1.276 | 1.647 | 2.0 |
|---|---:|---:|---:|---:|---:|---:|
| 1 Ultralight | 0.0115 | 0.6338 | 1.0 | 1.0680143742402992 | 1.1353465978260868 | 1.1162 |
| 2 Thin | 0 | 0.2328 | 0.7741935483870966 | 0.8679677704534828 | 0.9624792734922861 | 1.0524 |
| 3 Light | 0 | −0.0528 | 0.3333333333333333 | 0.47740059163160353 | 0.624976402173913 | 0.7878 |
| 4 Regular | 0 | −0.0715 | 0 | 0.18209370032725572 | 0.3697913043478261 | 0.5464 |
| 5 Medium | 0 | −0.0715 | 0 | 0.14843750853532175 | 0.30034952162225337 | 0.4641 |
| 6 Semibold | 0 | −0.0715 | 0 | 0.12263442816150573 | 0.24711082153264766 | 0.3875 |
| 7 Bold | −0.006 | −0.0739 | 0 | 0.08860427868299477 | 0.1768974634434575 | 0.2925 |
| 8 Heavy | 0 | −0.076 | 0 | 0.039241864054824986 | 0.07504951544595084 | 0.1862 |
| 9 Black | −0.1324 | −0.1325 | 0 | −0.004885142961266188 | 0.01599637746091113 | `[OBS]` |

The Black scalar `y`:

| weight | 0.2 | 0.5 | 1.0 | 1.276 | 1.647 | 2.0 |
|---|---:|---:|---:|---:|---:|---:|
| 1 Ultralight | 0.0221 | 0 | 0 | 0 | 0 | −0.0495 |
| 2 Thin | 0.0661 | 0 | 0 | 0 | 0 | −0.0104 |
| 3 Light | 0.435 | 0.2287 | 0 | 0 | 0 | 0 |
| 4 Regular | 0.6924 | 0.4969 | 0 | 0 | 0 | 0 |
| 5 Medium | 0.8145 | 0.6859 | 0.18 | 0.1649529780564263 | 0.13072859799999997 | 0.1072 |
| 6 Semibold | 0.9057 | 0.7909 | 0.318 | 0.2914169278996865 | 0.2309538564666666 | 0.2173 |
| 7 Bold | 0.9609 | 0.8937 | 0.5 | 0.45820271682340646 | 0.36313499444444436 | 0.352 |
| 8 Heavy | 1.1061 | 1.08 | 0.7639789473684211 | 0.7001337513061651 | 0.5548702715111109 | 0.5134 |
| 9 Black | 1.132 | 1.1847 | 1.0 | 0.9164054336468129 | 0.7262699888888887 | `[OBS]` |

Each value is the shortest decimal that reads back as the stored float64. `[OBS]` The
Black weight's pair at size 2.0 is not read.

`[BIN]` Only at size 1.0, the size the masters are drawn at (§5.4), is exactly one scalar
non-zero per weight. At the other sizes both can be non-zero and either can leave [0, 1]:
Regular at 1.276 is (0.18209370032725572, 0), which leans toward Ultralight, and Ultralight
at 2.0 is (1.1162, −0.0495). `[INF]` 0.7741935483870966 is 24/31 less one ulp and
0.7639789473684211 is 36289/47500, ratios that look measured from stroke widths; the other
values look entered by hand.

**Lookup.** `[BIN] CoreUI 26A5416b`
`+[CUIVectorGlyphMutator scalarsForGlyphContinuousWeight:glyphContinuousSize:]`
(0x18b4cf940) takes the size's row when the size is a key. Otherwise
`__segmentForGlyphContinuousSize` (0x18b4a9c04) gives the neighbouring sizes `lo`, `hi`
from `_kCoreThemeContinuousGlyphInternalSizes`; it computes the weight's pair at both and
blends them linearly in size, `S_lo + (S_hi − S_lo)·(size − lo)/(hi − lo)`
(0x18b4cfa78–0x18b4cfa8c). Within a row,
`+[CUIVectorGlyphMutator _scalarsForGlyphContinuousWeight:inDictionary:shouldClamp:]`
(0x18b4cf7a4) returns the pair of an exact key, which is how the nine named weights are
served. Otherwise `__segmentForGlyphContinuousWeight` (0x18b4a9c18, that is
`__segmentForValue` (0x18b4a9b70) over the nine weights) gives the bracketing keys `lo`,
`hi`, and it returns `P_lo + (P_hi − P_lo)·(w − lo)/(hi − lo)`, computed as one of three
equal FMADD forms by where `w` falls (0x18b4cf8b0–0x18b4cf910). When `|hi − lo| < 2^-52` it
returns `P_lo`; a missing key ends in a `.cold` assertion. The pair is therefore bilinear in
(weight, size) over the 9×6 grid.

`[BIN]` The discrete entry, `+[CUIVectorGlyphMutator scalarsForGlyphWeight:glyphSize:]`
(0x18b4cfab4), maps the weight enum through a jump table (`jpt_18B4CFB04`: 1…9 to
Ultralight…Black, 0 and 4 to Regular) and the GlyphSize through
`transformForGlyphSize:` (§5.4), then looks up as above. For an enum above 9 it skips the
load and uses whatever `d9` holds. `[INF]` The size call's selector is named from its
return value and its argument.

**Fractional weights.** `[BIN]` A weight between two keys is accepted: it gets the linear
blend of the two keys' pairs. The interpolation is in the scalars, not between neighbouring
masters. `[INF]` A weight `w` on the 1..9 scale with `n ≤ w ≤ n + 1` maps to the key
`k_n + (w − n)·(k_{n+1} − k_n)`, which gives the same pair as blending the pairs of `n` and
`n + 1` by `w − n`. Weight 6.5 at size 1.0: key 0.35, pair (0, (0.318 + 0.5)/2) = (0, 0.409).

**No clamping.** `[BIN]` `__segmentForValue` (0x18b4a9b70) clamps only when bit 0 of its
`w2` argument is set, to `(t0, t0)` below the table and `(t_last, t_last)` above it;
without that bit it returns the end segment, and the blend extrapolates linearly. At both
call sites that argument is `x0`, the nil result of the failed dictionary lookup, so 0, and
`shouldClamp:` (`x3`) is never read in 0x18b4cf7a4. `[INF]` As compiled, neither weight nor
size is clamped: a weight below −0.8 or above 0.62 extrapolates from the end segment, though
`scalarsForGlyphWeight:glyphSize:` passes `shouldClamp:YES` (`MOV W3,#1` at 0x18b4cfbb0) and
the continuous entry `NO` (0x18b4cfa18, 0x18b4cfa54).

**Applying the pair.** `[BIN] CoreUI 26A5416b` `-[CUIVectorGlyphMutator
applyDeltasWithScalars:andTransform:]` (0x18b4ce4a4) calls
`+createInterpolatedPointsFromPoints:ultralightDeltas:blackDeltas:withScalars:`
(0x18b4ce560) on the Regular points and the two delta arrays, CGPoint doubles, which
`+deltaArrayFrom:to:` (0x18b4cf5a0) builds (equal counts required, else `.cold.1`). Per
coordinate:

```
p = R + x·(UL − R) + y·(B − R)
```

`[INF]` The Accelerate calls (`vDSP_vsmsmaD`, `vDSP_vaddD`, `vDSP_vsubD`) are named from
their argument shapes; `[OBS]` the sign of the deltas (`to − from`) rests on `vDSP_vsubD`'s
semantics and on the argument order of `deltaArrayFrom:to:`, which the decompiler hid.
`[INF]` It agrees with (1, 0) being Ultralight.

**What the pair applies to.** `[BIN] CoreUI 26A5416b` Each
`-[CUINamedVectorGlyph(Interpolation) _interpolated…WithWeight:glyphSize:fromUltralight:regular:black:]`
takes the pair for (weight, size) and mixes its quantity in the same form; the size scale
`S` of §5.4 follows where the table says:

| quantity | method | after the mix |
|---|---|---|
| path points | `_interpolatedPathWithWeight:…` (0x18b4c6a08) → `pathForScalars:andTransform:` (0x18b4cef78) | × S |
| canvas size (w, h) | `_interpolatedCanvasSizeWithWeight:…` (0x18b4c6d04) | × S |
| alignment-rect insets (4) | `_interpolatedAlignmentRectInsetsWithWeight:…` (0x18b4c6db4) | × S |
| anchor (x, y) | `_interpolatedAnchorWithWeight:…` (0x18b4c6f38) | × S |
| baseline offset | `_interpolatedBaselineOffsetWithWeight:…` (0x18b4c6c1c) | `S·b + K·(S − 1)·X` (§5.4) |
| cap height | `_interpolatedCapHeightWithWeight:…` (0x18b4c6cb8) | not scaled |

`[INF]` The pair comes from stub 0x1900245D0, named
`scalarsForGlyphContinuousWeight:glyphContinuousSize:` from its arguments (`d0` weight,
`d1` size) and its return (`d0`, `d1`). `[INF]` "Canvas size" is the viewBox size and
"anchor" the rotation anchor, by name. `[OBS]` Which stored quantities feed the canvas and
anchor methods (viewBox or canvas; rotation anchor or metric centre) is not traced.
`[OBS]` Not read: `_interpolatedStrokeWidthWithWeight:…` (0x18b4c6eb8),
`_createInterpolatedDrawAttachmentDataStoreWithWeight:…` (0x18b4c6ff4) and
`clipStrokeKeyframesForPath:scalars:` (0x18b4ce85c). `[OBS]` Whether the master path objects
the mutator receives already carry the document `transform`, and so whether that transform
is interpolated. How a reader applies all this to the metrics and pivots: [06](06-drawing.md)
§9.4.

Worked example `[INF]`, `wifi` Semibold, from the viewBox widths above: at size 1.0 the pair
is (0, 0.318) and the width `11.30517 + 0.318·(12.136713 − 11.30517)` = 11.569601; at size
1.276 the pair is (0.12263442816150573, 0.2914169278996865), the mixed width 11.506238 and,
× 1.276, 14.681960.

**Incompatible points.** `[BIN] CoreUI 26A5416b` `-[CUIVectorGlyphMutator
initWithPointSize:regular:ultralight:black:]` (0x18b4cd454) builds a point array per master
with `+pointArrayFromPath:` (0x18b4cf094; block 0x18b4cf224) and compares the three counts.
When they differ it logs "CoreUI: Incompatible points when attempting to interpolate:
Ultralight=%lu, Regular=%lu, Black=%lu" (0x18b5a776b) and raises an `NSException`. The block
walks the path element by element and appends:

| element type | points |
|---:|---:|
| 0 | 1 |
| 1 | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 and any other | 0 |

`[INF]` These are `CGPathElementType` values (move, line, quad curve, cubic curve, close),
so a point is every on-curve or control point of the master's path, and a close counts
none. `[BIN]` Only the counts are compared, not the element types.
`_interpolatedPathWithWeight:…` (0x18b4c6a08) catches
`CUIVectorGlyphIncompatiblePointsException` (0x1e0923880), logs the glyph name and bundle
id, raises again and returns nil. Points, not commands: the masters' commands differ, their
points do not ([03](03-bvg-paths-and-numbers.md) §7).

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
transform (`+[CUIVectorGlyphMutator transformForGlyphSize:]`) and by the weight table's
size rows (§5.2).

**The transform.** `[BIN] CoreUI 26A5416b` `+[CUIVectorGlyphMutator transformForGlyphSize:]`
(0x18b4cf6e8) returns two doubles `(S, T)` in `d0`, `d1`, not a `CGAffineTransform`:

| GlyphSize | S | T = K·(1 − S) |
|---|---:|---:|
| 0 None, 1 Small | 1.0 | 0 (`MOVI V1,#0`) |
| 2 Medium | 1.276 (`…SizeMedium`) | −0.09723339843750001 |
| 3 Large | 1.647 (`…SizeLarge`) | −0.22793481445312502 |
| any other | 0 | 0 |

`K` = `qword_18B592950` = **0.352294921875** (`3FD68C0000000000`), and `qword_18B592958` =
−K; the code is `FMADD D1, D0, D2, D1`, so `T = S·(−K) + K`. `[INF]` The two T values are
that expression evaluated in float64.

`[BIN]` `+[CUIVectorGlyphMutator transformForGlyphContinuousSize:]` (0x18b4cf744) tail-calls
`transformForGlyphSize:` with the matching enum when the size is exactly 1.0, 1.276 or
1.647, and otherwise returns `(size, K·(1 − size))`: the same formula with `S = size`,
continuous in size.

**What it scales.** `[BIN] CoreUI 26A5416b`

- **Path.** `_interpolatedPathWithWeight:…` passes `andTransform:(S, 0)` (`d3` zeroed by
  `MOVI V3.2D,#0` at 0x18b4c6aa4). `applyDeltasWithScalars:andTransform:` (0x18b4ce4a4)
  multiplies every coordinate by S, then adds `T·pointSize` to the y coordinates only; with
  T = 0 the path is scaled by S **about the master's coordinate origin**, with no
  translation. `[INF]` `pointSize` is the mutator's own.
- **Canvas size, the four alignment-rect insets, the anchor:** × S after the weight mix
  (§5.2).
- **Baseline offset.** `_interpolatedBaselineOffsetWithWeight:…` (0x18b4c6c1c) returns

  ```
  b' = S·b − T·X = S·b + K·(S − 1)·X
  ```

  with `b` the weight-mixed baseline offset and `X` the value of stub 0x190024290 on the
  named glyph, the same value passed to `initWithPointSize:` for the path.
- **Cap height:** the weight mix only, **not scaled**.

`[INF]` `X` is `referencePointSize`: `K = 1443/4096`, and 1443/2048 is the SF cap height
measured in [06](06-drawing.md) §9.1 (`capHeight` 9.15967 at 13 pt = 1,443 path units), so
`K·X` is half the cap height. `[OBS]` The stub's selector is not read; `X` could be
`pointSize`.

`[INF]` With `baselineOffset` measured **up from the viewBox bottom** ([06](06-drawing.md)
§9.1), `S·b + K·(S − 1)·X` is the baseline that keeps the cap-height midline, `K·X` above
the baseline, where it was relative to the baseline after the drawing is scaled by S about
its origin: `b' + K·X = S·(b + K·X)`. Medium and Large are therefore a **uniform scale by
1.276 or 1.647 about the cap-height centre**. The scale goes into the geometry, the canvas,
the insets and the anchor, the centring into the baseline offset, and the cap height stays.

Worked example `[INF]`, a master with `referencePointSize` 13: Large gives
`b' = 1.647·b + 0.352294921875·0.647·13 = 1.647·b + 2.963152587890625`, Medium
`b' = 1.276·b + 1.2640341796875`.

**Size changes the weight.** `[BIN]` The size picks the scalar table's row (§5.2), so at
Medium and Large a weight is drawn with other `(x, y)` than at Small: Regular at Medium is
(0.18209370032725572, 0), the strokes thinned toward Ultralight against the 1.276× scale.
`[INF]` A Medium or Large rendering is not the Small one × S; even Regular needs the
Ultralight and Black masters.

**GlyphSize None.** `[BIN]` `transformForGlyphSize:` maps 0 to S = 1.0, but the named
glyph's `…weight:glyphSize:…` initialiser (`-[CUINamedVectorGlyph …]`, 0x18b4a0310) maps it
to 1.276 through its table 0x18b58c7c8 = [1.276, 1.0, 1.276, 1.647] (index = enum; above 3,
1.0); its weight table 0x18b58c778 = [0, −0.8, −0.6, −0.4, 0, 0.23, 0.3, 0.4, 0.56, 0.62]
(above 9, −0.8). `[INF]` It tail-calls the continuous initialiser (stub 0x190022F30).

`[BIN] CoreUI 26A5416b` Dimension2 is a point-size class:
`___VectorGlyphDimension2ToPointSizeTableForMac` (`0x18b594f28`) is `[11.0, 13.0, 17.0]`
and the embedded table (`0x18b594f40`) is `[15.0, 17.0, 20.0]`. The twelve measurement
renditions per symbol are Dimension2 {0,1,2} × GlyphSize {2,3} × Scale {1,2}; Small has
none, consistent with Small being the master's own size. `[CAR]`

**Independent of Dimension2 and point size.** `[BIN] CoreUI 26A5416b`
`transformForGlyphSize:` and `transformForGlyphContinuousSize:` read only the size constants
and K: no point size, no Dimension2, no `___VectorGlyphDimension2ToPointSize*` table. Those
tables are read by `_CUIPointSizeForDimensionForVectorGlyph` (0x18b528fac): idiom 0 the Mac
table, idiom 4 a constant 17.0, any other idiom the embedded table, indexed by Dimension2.
The only length in the transform's results is `X` in the baseline, which the shift is
proportional to. `[OBS]` Who calls `_CUIPointSizeForDimensionForVectorGlyph`, and how it
bears on drawing.

`[OBS]` The final scale from master units to device points is not read. `[INF]` It is most
likely `pointSize / referencePointSize`, given the masters' `transform` scale of
`referencePointSize / 2048` ([06](06-drawing.md) §9.1); the rendered size is then that ratio
× S. `[OBS]` The continuous catalog entry
`-[CUICatalog namedVectorGlyphWithName:…glyphContinuousSize:…]` (0x18b539694) and the
continuous `CUINamedVectorGlyph` initialiser (0x18b49ff94, 0x18b4a0048) are not read, nor
any point-size scaling above CoreUI (a text-style multiplier, for instance).

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
