# 02 — The `BVG ` document

`BVG ` (Binary Vector Graphics) is Apple's binary serialization of an SVG document: a
header, a string pool, a style block and a node tree. Every symbol master
([01](01-bom-and-car.md) §5.2) is one. This document covers everything except the
nibble-packed path and number codec ([03](03-bvg-paths-and-numbers.md)) and the style
block ([04](04-style-block.md)).

The decoder for this format lives in CoreUI, which ships it with full symbol names.
`[BIN]` facts below are `CoreUI 26A5416b`:

| piece | symbol | address |
|---|---|---|
| document header | `CSIBVGLayout::DocumentV1::svgDocument` | `0x18b54e9f4` |
| string pool | `CSIBVGLayout::StorageReader<h,h>::dataAtIndex` | `0x18b54f5ac` |
| predefined atoms | `CSIBVGLayout::StorageReader<h,h>::atomAtIndex` | `0x18b54f8a0` |
| node tree | `CSIBVGLayout::NodeRecord<h,h>::svgNode` | `0x18b54eed4` |
| attributes | `NodeRecord<h,h>::readAttributesToSVGNode` | `0x18b54fc20` |
| predefined strings | `_CSIBVGPredefinedStrings` (89 strings) | `0x1e0923910` |

## 1. Header

### 1.1 Layout

`[BIN]` Everything in a `BVG ` document is **little-endian**. Offsets are absolute from the
`B` of the magic.

```
char   magic[4]                 'BVG '
u8     version                  1
u8     typeCode                 (indexWidth << 4) | offsetWidth
Offset nodeOffset               start of the node area
Offset styleOffset              start of the style block
Index  stringCount
Offset stringOffsets[stringCount + 1]       with a sentinel
```

### 1.2 Version

`[BIN]` Version 1 is the only version CoreUI reads; `[CAR]` every document on `26A5416b`
is version 1. Anything else is refused.

### 1.3 Field widths

`[BIN]` `indexWidth = typeCode >> 4` and `offsetWidth = typeCode & 0xF`, each **1, 2 or
4 bytes**. Any other width is refused. `[CAR]` Type codes seen: `0x11`, `0x12`, `0x22`.

Two field types run through the whole document:

- **Index** — `indexWidth` bytes: string-pool indices, counts of strings, pairs and
  classes.
- **Offset** — `offsetWidth` bytes: byte offsets.

**Every field after `typeCode` is typed by these widths** — the header's own offsets,
the string offsets, the node area and the style block. Hard-coding `u16` works for a
`0x12` document and shifts a `0x11` document by one byte per field, and the shifted
document still parses, into nonsense.

### 1.4 Section order

`[BIN]` The style block spans `[styleOffset, nodeOffset)`: it comes **before** the node
area, and the node area runs from `nodeOffset` to the end of the document.
`[INF]` `styleOffset > nodeOffset` is malformed.

## 2. The string pool

### 2.1 Local strings

`[BIN]` The local strings are the byte ranges `[stringOffsets[i], stringOffsets[i+1])`,
absolute from the start of the document, for `i` in `0 … stringCount-1`. The last offset,
the sentinel, equals `styleOffset`: the pool ends where the style block begins. A string
has no terminator; its bytes are its value, as text or as a binary blob depending on who
reads it (§5).

`[INF]` Validate the table before using it: the offsets must be non-decreasing and the
sentinel must not pass the end of the document. A count of offsets that cannot fit in the
bytes remaining (`(stringCount + 1) * offsetWidth > remaining`) is corrupt and must be
rejected before anything is sized from it.

`[INF]` Text strings are read as UTF-8; every string measured is ASCII.

### 2.2 Indices: atoms below 89

`[BIN]` A string index **below 89 is not in the document**: it names one of CoreUI's 89
predefined atoms (§3). Index 89 is the first local string, so local string `i` has index
`89 + i`. An index that is neither an atom nor below `89 + stringCount` names nothing.

## 3. The 89 predefined atoms

`[BIN] CoreUI 26A5416b` `_CSIBVGPredefinedStrings` (`0x1e0923910`), in order. This table
is part of the format: every index dispatch in docs 02–06 is against it.

| # | atom | # | atom | # | atom |
|---:|---|---:|---|---:|---|
| 0 | `svg` | 30 | `none` | 60 | `monochrome` |
| 1 | `g` | 31 | `0` | 61 | `data-clipstroke-keyframes` |
| 2 | `viewBox` | 32 | `1` | 62 | `LayerTree` |
| 3 | `path` | 33 | `0.0` | 63 | `s` |
| 4 | `rect` | 34 | `-sfsymbols-motion-group` | 64 | `ra` |
| 5 | `circle` | 35 | `-sfsymbols-variable-threshold` | 65 | `da` |
| 6 | `ellipse` | 36 | `-sfsymbols-layer-tags` | 66 | `black` |
| 7 | `line` | 37 | `-sfsymbols-always-rotates` | 67 | `controlAccentColor` |
| 8 | `polyline` | 38 | `-sfsymbols-draw-reverses-motion-groups` | 68 | `knockout` |
| 9 | `polygon` | 39 | `-sfsymbols-variable-value-mode` | 69 | `labelColor` |
| 10 | `width` | 40 | `-sfsymbols-vc-continuous` | 70 | `secondaryLabelColor` |
| 11 | `height` | 41 | `-sfsymbols-always-pulses` | 71 | `tertiaryLabelColor` |
| 12 | `x` | 42 | `-sfsymbols-clear-behind` | 72 | `quaternaryLabelColor` |
| 13 | `y` | 43 | `-sfsymbols-fill-action` | 73 | `systemBlueColor` |
| 14 | `cx` | 44 | `-sfsymbols-indices` | 74 | `systemBrownColor` |
| 15 | `cy` | 45 | `-sfsymbols-variable-draw` | 75 | `systemCyanColor` |
| 16 | `r` | 46 | `-sfsymbols-clipstroke-attachments` | 76 | `systemGrayColor` |
| 17 | `rx` | 47 | `-sfsymbols-wiggle-style` | 77 | `systemGreenColor` |
| 18 | `ry` | 48 | `-sfsymbols-rotates-clockwise` | 78 | `systemIndigoColor` |
| 19 | `fill` | 49 | `color` | 79 | `systemMintColor` |
| 20 | `opacity` | 50 | `draw` | 80 | `systemOrangeColor` |
| 21 | `transform` | 51 | `erase` | 81 | `systemPinkColor` |
| 22 | `d` | 52 | `.defaults` | 82 | `systemPurpleColor` |
| 23 | `points` | 53 | `true` | 83 | `systemRedColor` |
| 24 | `id` | 54 | `false` | 84 | `systemTealColor` |
| 25 | `class` | 55 | `primary` | 85 | `systemYellowColor` |
| 26 | `x1` | 56 | `secondary` | 86 | `tintColor` |
| 27 | `y1` | 57 | `tertiary` | 87 | `white` |
| 28 | `x2` | 58 | `multicolor` | 88 | `custom` |
| 29 | `y2` | 59 | `hierarchical` | | |

What the table says by itself: the animation parameters (34–48) and the colour and
rendering-mode vocabulary (49–60, 66–88) are part of the document, not code elsewhere.

`[CAR]` Three properties the documents use are **not** atoms and arrive as local strings:
`-sfsymbols-wiggle-angle`, `-sfsymbols-has-fill-images`, `-sfsymbols-fill-image-names`
([04](04-style-block.md) §5.4). So is the attribute name `data-d` (§5.4). A local
string's index differs per document, so these are matched by their text, never by index.
Inserting them into the table above would shift every later index.

## 4. The node area

### 4.1 Layout

`[BIN]` At `nodeOffset`:

```
Index  pairCount
(Index stringIndex, Offset nodeOffset)[pairCount]      the id table
NodeRecord root                                        immediately after the table
```

Node offsets — in the id table and in child lists — are **relative to the start of the
node area** (`nodeOffset`), not to the document. The root's relative offset is
`indexWidth + pairCount * (indexWidth + offsetWidth)`.

### 4.2 The id table

`[BIN]` The pair table is the id map: a node record whose relative offset equals a pair's
`nodeOffset` gets `id = string(stringIndex)`. `wifi` has one pair, `("s", 13)`, which is why
its group is `<g id="s">`.

### 4.3 Node record

`[BIN]`

```
Index  tagIndex                   string index of the tag (0 = svg, 1 = g, 3 = path, ...)
Index  idIndex                    see below
u8     attrCount
u8     classCount
u8     childCount
(Index nameIndex, Index valueIndex)[attrCount]
Index  classIndex[classCount]
Offset childOffset[childCount]    relative to the node area
```

`[OBS]` What does the record's own `idIndex` field hold? A node's id comes from the id
table (§4.2); a reader skips this field.

`[BIN]` **Class indices are not string indices.** They index the class list the style
block builds ([04](04-style-block.md) §1), whose entry 0 is `.defaults`. Resolving them
through the string pool gives plausible garbage (`class="g viewBox path"`). When a node is
written out as SVG, each class name loses its leading `.` and the names are joined with
spaces.

`[INF]` Robustness: a child offset that does not strictly advance past its parent's offset
is a cycle in corrupt input and is rejected; depth is bounded (64 is ample).

### 4.4 Tag dispatch

`[BIN]` `NodeRecord::svgNode` dispatches on `tagIndex`:

| tagIndex | node |
|---|---|
| 1 (`g`) | group |
| 3–9 (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`) | shape |
| anything else (0 `svg`, …) | generic element |

`[CAR]` The root is always `svg` (tag 0). Only `path` and `circle` carry geometry in the
reference build: no document has a `width`, `height`, `rx`, `ry`, `points`, `x1` or `y1`
attribute (§6), so `rect`, `ellipse`, `line`, `polyline` and `polygon` cannot.

### 4.5 The ids that mean something

`[CAR]` The atoms 62–65 are ids:

| id | node | role |
|---|---|---|
| `s` | `g` | the drawing group; its `transform` maps path coordinates to the viewBox ([06](06-drawing.md) §2) |
| `LayerTree` | `g` | a geometry-free tree of class-carrying groups, on shape-group symbols ([06](06-drawing.md) §7) |
| `ra` | `circle` without `r` | the rotation anchor marker ([06](06-drawing.md) §9) |
| `da` | `g` | carries `data-d`, the Draw attachment data ([06](06-drawing.md) §6.3) |

## 5. Attribute values

### 5.1 Dispatch by name index

`[BIN]` `readAttributesToSVGNode` decides how to read a value by the attribute's **name
index**, never by the value:

| name index | value |
|---|---|
| 22 (`d`) | the value index names a local string that is a **path blob** ([03](03-bvg-paths-and-numbers.md) §3) |
| 2 (`viewBox`), 61 (`data-clipstroke-keyframes`) | the value index names a local string that is a **numeric-list blob** ([03](03-bvg-paths-and-numbers.md) §4) |
| anything else | the value index names an ordinary string, atom or local |

`[INF]` If the value index of a path or list attribute is an atom rather than a local
string, there is no blob; the value is that atom's text. No document does this `[CAR]`.

A local string's index is always ≥ 89, so a local attribute name can never equal 2, 22 or
61. Its value is always plain text.

### 5.2 `viewBox`

`[CAR]` On the root `svg`, a numeric list of four numbers `x y w h`, in points. `wifi`
Ultralight: `0 0 10.968744 7.959957`.

### 5.3 `transform`

`[CAR]` On `<g id="s">`, a plain string `matrix(a b c d e f)`. `wifi` Ultralight:
`matrix(0.00634765 0 0 0.00634765 -0.901367 8.58203)` — it scales the path's design
units (roughly 2,000 per em) down to the viewBox's points. `[INF]` The six numbers are
separated by spaces or commas.

### 5.4 `data-d` — literal text

`[CAR]` `data-d` is an attribute whose **name is a local string**, not an atom. Its value is
**literal text**, not a blob: on `arrow.left.to.line`, local string 99 is the name and
string 100 the value, `0 1.000000 0.000000 3.643169 3.808577`. Because dispatch is by
name index and a local index is ≥ 89, it matches neither `d` nor the numeric-list names.
Its grammar is in [06](06-drawing.md) §6.3.

### 5.5 `circle`

`[CAR]` `circle` nodes (tag 5) carry `cx`, `cy` (atoms 14, 15) and, when they are drawn
geometry, `r` (atom 16), each a plain numeric string. A `circle` **without `r`** is a marker
(`ra`), not geometry. How a drawn circle becomes a path: [06](06-drawing.md) §3.3.

### 5.6 `fill` with a literal colour

`[CAR]` Some shape nodes carry `fill` (atom 19) with a literal colour `#RRGGBB`
(`#FF5C5F`, `#34C759`, …): fixed-colour artwork. Every such node also carries a
`.multicolor-N:custom` class whose rule repeats the same `fill`. What it means for paint:
[06](06-drawing.md) §4.4.

### 5.7 `opacity`

`[CAR]` Some shape nodes carry `opacity` (atom 20) as an attribute, e.g. `0.0`. Every such
node also has a class declaring an opacity; the attribute repeats one of those
declarations. Which value a layer takes: [06](06-drawing.md) §4.5.

### 5.8 `data-clipstroke-keyframes`

`[CAR]` On shape nodes, a numeric list (name index 61). Its grammar is in
[06](06-drawing.md) §6.1.

## 6. Attribute census

`[CAR]` Attribute names over all documents (count of attributes):

```
d 25,283   viewBox 10,343   transform 10,343   opacity 5,176
data-d 630   cx/cy 180   fill 58
```

plus `data-clipstroke-keyframes` on 14,523 nodes in 10,527 documents (counted separately,
[06](06-drawing.md) §6.1). No other attribute name occurs.

`[OBS]` This census and the keyframe census were taken in separate passes and their
populations are not reconciled: the census above shows `viewBox` 10,343 times where the
document count is 36,975, so it was likely taken over one master per symbol, while the
keyframe census covers all 36,975 documents. Treat the counts above as a vocabulary, not
as totals.
