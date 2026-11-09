# 04 — The style block

The part of a `BVG ` document that the node tree does not carry: the rendering-mode
classes, each layer's role or colour, the knockout, and every animation parameter. It
spans `[styleOffset, nodeOffset)` ([02](02-bvg-document.md) §1.4).

`[BIN]` facts are `CoreUI 26A5416b`:
`CSIBVGLayout::StyleData<Index,Offset>::addStylesToSVGDocument` (`0x18b54ec10` for the
`<u8,u8>` instantiation; nine instantiations exist, one per width combination),
`DeclarationRecord::attributeMap` (`0x18b54f2e0`), `PropertyRecord::valueString`
(`0x18b54f964`), the prefix table `_CSIBVGCSSClassPrefixesCStr` (`0x1e0923bd8`).
`[CAR]` counts are over the 36,975 documents of both `26A5416b` catalogs unless marked
"public".

## 1. Layout

### 1.1 Records

`[BIN]` Little-endian; `Index` and `Offset` have the document's widths
([02](02-bvg-document.md) §1.3), exactly as in the node area:

```
Index   classCount
ClassRecord[classCount]
    u8      kind
    u8      layer
    Index   value
    Offset  ruleOffset          relative to the start of the style block
Rule …                          packed, no padding, to the end of the block
    u8      declCount
    Declaration[declCount]
        Index   property        string index (usually an atom)
        u8      valueCount
        Index   value[valueCount]
```

The rules run from the end of the class records to the end of the block (`nodeOffset`).

### 1.2 Invariants

`[CAR]` On all 36,975 documents: every `ruleOffset` lands on a rule boundary, and no rule
start is left that no class points at. `[INF]` A reader checks the first (a class whose
`ruleOffset` is not a rule start is malformed); an unreferenced rule is worth reporting but
is not an error.

`[INF]` Every string index in a class record or declaration must name an atom or an
existing local string; an index that names nothing is a malformed document, not a property
to skip.

## 2. Classes

### 2.1 Naming

`[BIN]` A class's name comes from its record:

- `kind & 0x80 == 0` — a **named** class: the name is `string(value)`. `[CAR]` Always
  `.defaults` (atom 52), always record 0. `[INF]` Any other `kind` with the high bit clear
  is not a defined kind and is malformed.
- `kind & 0x80 != 0` — a **family** class: `prefix[kind & 0x7F] + decimal(layer)`, and,
  if `value != 0xFF`, `+ ":" + string(value)`. `[BIN]` `kind & 0x7F ≥ 4` stops CoreUI's
  reader; `[INF]` treat it as malformed.

`[INF]` `0xFF` is the "no value" sentinel at every index width (it is compared as the
number 255, not as "all ones").

### 2.2 The four prefixes

`[BIN]` `_CSIBVGCSSClassPrefixesCStr`:

| kind | prefix | value |
|---|---|---|
| `0x80` | `.monochrome-` | always `0xFF` `[CAR]` |
| `0x81` | `.multicolor-` | a colour **name** — `tintColor`, `white`, `systemBlueColor`, `custom`, … |
| `0x82` | `.hierarchical-` | a role: `primary`, `secondary` or `tertiary` |
| `0x83` | `.shapeGroupLayer-` | always `0xFF` `[CAR]` |

`[CAR]` A multicolor value is **not necessarily an atom**: values at index 91 occur, i.e.
local strings. Read it as a string, whatever its index.

`[CAR]` `knockout` (atom 68) is a multicolor colour name (`.multicolor-N:knockout`), not
the knockout mechanism; that is `-sfsymbols-clear-behind` (§5.3).

### 2.3 The class list

`[CAR]` The list a node's class indices point into ([02](02-bvg-document.md) §4.3) is, in
record order:

```
[".defaults", ".monochrome-0", ".multicolor-0:tintColor", ".hierarchical-0:primary",
 ".monochrome-1", …]
```

— `.defaults`, then three family records per layer (one per mode) in layer order, plus one
`.shapeGroupLayer-N` per shape group where present. Node class indices `[1, 2, 3]` are
layer 0's three modes, `[4, 5, 6]` layer 1's, and so on.

`[CAR]` **No node references `.defaults`.** Its declarations are therefore per document by
construction.

`[CAR]` A node can carry more than one class of the same family: 1,206 shape nodes carry
two or more `.monochrome-` classes (on `air.purifier.fill`'s Regular master, one node
carries both `.monochrome-0` with motion group 2 and `.monochrome-2` with motion group 0).
Which one a reader uses is a choice: [06](06-drawing.md) §4.1.

### 2.4 Rules are often shared, not always

`[CAR]` A layer's three family classes often point at **one** rule (same `ruleOffset`),
which then carries the layer's motion group, tags and, optionally, `opacity`,
`clear-behind`, `variable-threshold` and `always-pulses`. But not always: 9,942 nodes in
9,411 documents have a monochrome class whose `clear-behind` or `opacity` their
hierarchical or multicolor class does not repeat. Example, `speaker.wave.2.circle.fill`:
the speaker is `.monochrome-1` (`clear-behind: true`, `opacity: 0.0` — a hole cut through
the disc), `.hierarchical-1:primary` and `.multicolor-1:white`, and those two rules carry
neither declaration: in those modes the speaker is drawn, not cut.

## 3. Declarations

### 3.1 Values

`[BIN]` Each declaration value is one string index; the value is that string's text. A
multi-valued declaration is a list of separate strings, not one joined string.

`[CAR]` Value counts observed: 1 (the norm), 2, 3, 4, 5, 6, 11, 13, 16, 21.

### 3.2 Multi-valued properties

`[CAR]` Exactly four properties carry more than one value:

| property | values |
|---|---|
| `-sfsymbols-layer-tags` | one tag per value |
| `-sfsymbols-variable-draw` | always exactly 2 |
| `-sfsymbols-clipstroke-attachments` | 6, 11, 16 or 21 tokens — §5.2 |
| `-sfsymbols-indices` | 1 to 13 integers |

Every other property has exactly one value. `[INF]` A known single-valued property with a
different count is malformed.

`[OBS]` CoreUI's `<u8,u8>` `valueString` returns an empty string when `valueCount ≠ 1`, and
the branch that handles several values was not readable. How CoreUI itself joins a
multi-valued declaration is therefore not read; the readings in §3.2 and §5 come from the
values as stored.

### 3.3 Booleans and numbers are atoms

`[CAR]` Every boolean value is the atom `true` (53) or `false` (54) — never `1` or `0`,
which are separate atoms (32, 31) used for numbers. Numbers are their decimal text
(`0`, `0.51`, `-90`). `[INF]` A boolean property whose value is anything but `true` or
`false` is an unknown value, and is reported as an error naming the property and the
value, never folded into `false`.

### 3.4 Unknown properties and unknown values

`[INF]` An **unknown property** — a `-sfsymbols-*` name not listed in §4.1, or a CSS
property other than `opacity` and `fill` — is an error naming it, so that a new build's
vocabulary is seen rather than skipped. The properties §4.1 lists but nothing consumes
(`-sfsymbols-has-fill-images`, `-sfsymbols-fill-image-names`, §5.4) are known and are
accepted without being read. An **unknown value** on a **known** property with a closed
vocabulary is an error naming both, so that a new build's vocabulary is seen rather than
defaulted.

### 3.5 A property declared twice in one rule

`[INF]` Declarations are read in stored order and every one is validated; when one rule
declares the same property more than once, the **last** declaration is the one used. This
is the CSS cascade within one rule, and it keeps a repeated declaration a value rather than
a reason to refuse the document. `[OBS]` Whether any rule on `26A5416b` repeats a property
was not measured; the rule exists so that a reader has one answer.

## 4. Property census

### 4.1 Counts and where each property sits

`[CAR]` By declaration count, number of identifiers carrying it, and the class it is
declared on:

| property | decls | identifiers | declared on | values seen |
|---|---:|---:|---|---|
| `-sfsymbols-motion-group` | 94,692 | 10,178 | family | `0` 56,592 · `1` 34,380 · `2` 2,475 · `3` 636 · `4` 288 · `5` 108 |
| `-sfsymbols-layer-tags` | 94,692 | 10,178 | family | free strings — §5.1 |
| `-sfsymbols-draw-reverses-motion-groups` | 36,975 | 10,178 | `.defaults` | `true` 24,660 · `false` 12,315 |
| `-sfsymbols-variable-value-mode` | 36,975 | 10,178 | `.defaults` | `color` 33,696 · `draw` 3,279 |
| `-sfsymbols-always-pulses` | 28,896 | 5,000 | family | `true` only |
| `-sfsymbols-clear-behind` | 19,308 | — | family | boolean |
| `-sfsymbols-variable-threshold` | 7,692 | 600 | family | `0.0` 2,052, then 0.26, 0.39, 0.51, 0.64, 0.76, 0.89 and others |
| `-sfsymbols-wiggle-style` | 5,244 | 1,649 | `.defaults` | `linear` 4,068 · `clockwise` 756 · `counterClockwise` 420 |
| `-sfsymbols-wiggle-angle` | 4,068 | — | `.defaults` | degrees — §4.3 |
| `-sfsymbols-variable-draw` | 3,648 | 918 | family | always a pair; `0 1` in 3,402 |
| `-sfsymbols-always-rotates` | 3,357 | 376 | family | `true` only |
| `-sfsymbols-clipstroke-attachments` | 2,700 | 658 | family | §5.2 |
| `-sfsymbols-rotates-clockwise` | 876 | 240 | `.defaults` | `true` 498 · `false` 378 |
| `-sfsymbols-indices` | 588 | 44 | `.shapeGroupLayer-N` (447), family (132) | small integers, 1 to 13 per declaration |
| `-sfsymbols-fill-action` | 432 | 44 | `.shapeGroupLayer-N` | `draw` 291 · `erase` 141 |
| `-sfsymbols-vc-continuous` | 153 | 51 | `.defaults` | `true` only |
| `-sfsymbols-has-fill-images` | 3 | — | `.defaults` | — |
| `-sfsymbols-fill-image-names` | 3 | — | `.defaults` | — |
| `opacity` (atom 20) | — | — | family | a number, e.g. `0.0` |
| `fill` (atom 19) | — | — | `.multicolor-N:custom` | `#RRGGBB` |

"Family" means the `.monochrome-N` / `.multicolor-N` / `.hierarchical-N` classes.
`[CAR]` Public catalog only: `opacity` is declared 14,994 times and `fill` 159 times.

`.defaults` always carries `-sfsymbols-variable-value-mode` and
`-sfsymbols-draw-reverses-motion-groups`.

`[CAR]` On `.defaults`, `-sfsymbols-rotates-clockwise` is **absent** on 36,099 documents
and `false` on 378: absent is not the same as `false`.

### 4.2 Closed vocabularies

`[CAR]` These properties take only the listed values on `26A5416b`. `[INF]` Treat each list
as closed (§3.4).

| property | vocabulary |
|---|---|
| every boolean property (`always-pulses`, `always-rotates`, `clear-behind`, `draw-reverses-motion-groups`, `rotates-clockwise`, `vc-continuous`) | `true`, `false` |
| `-sfsymbols-variable-value-mode` | `color`, `draw` |
| `-sfsymbols-wiggle-style` | `linear`, `clockwise`, `counterClockwise` |
| `-sfsymbols-fill-action` | `draw`, `erase` |
| `.hierarchical-N` class value | `primary`, `secondary`, `tertiary` |

`[INF]` `clear-behind`'s values were not tallied separately; it is listed as boolean like
the other properties of its kind.

### 4.3 `-sfsymbols-wiggle-angle`

`[CAR]` Degrees, one value. The full histogram (4,068 declarations):

```
-135: 150   -90: 678   -45: 213   -30: 24   0: 1,176
  45: 138    90: 591   135: 228   180: 870
```

Not all multiples of 45: `-30` occurs on 24 documents
(`car.side.hill.down.and.gauge.open.with.lines.needle.25percent.and.arrowtriangle.fill`
and its localizations). `[INF]` Read it as an opaque number.

### 4.4 `-sfsymbols-variable-threshold`

`[CAR]` One number in `[0, 1]`; 38 distinct values. Many look like `i/N` rounded to two
decimals (0.26, 0.39, 0.51, … step 0.13), for several `N`. `[INF]` Read it as an opaque
number; infer no quantisation.

### 4.5 `-sfsymbols-variable-draw`

`[CAR]` Always exactly two numbers. Not a (start, end) interval: 180 of the 3,639
reachable pairs have first > second, and `touchid`'s six layers read
`(0, 0.17) (0.17, 0.17) (0.33, 0.17) (0.5, 0.17) (0.67, 0.17) (0.83, 0.17)`.

`[OBS]` What do the two numbers mean? `touchid` reads like (offset, length), but this is not
established. Decode the pair; assign it no meaning.

### 4.6 `-sfsymbols-indices` and `-sfsymbols-fill-action`

`[CAR]` Declared on `.shapeGroupLayer-N` classes, which in this catalog are attached only to
`<g>` nodes of the geometry-free `<g id="LayerTree">` subtree ([06](06-drawing.md) §7). **No
shape node in any document can reach either property.** The 132 `-sfsymbols-indices`
declarations on family classes are likewise unreachable from a shape node.

## 5. Property grammars

### 5.1 `-sfsymbols-layer-tags`

`[CAR]` Free strings, one per value, usually the symbol's own name. Four underscore tags
have a meaning to the renderer: `_badge` (7,941 layers), `_enclosure.stroke` (7,908),
`_enclosure.fill` (5,154), `_slash` (1,611).

### 5.2 `-sfsymbols-clipstroke-attachments`

`[BIN] CoreGlyphsLib (SF Symbols app 8)`, CoreUI's attachment store. The declaration is a
list of **attachments separated by `,`**, each a whitespace-separated sequence:

```
attachment := format flags targetLayer targetSubpath dataIndex rider_0 … rider_{N-1}
```

`[CAR]` In the declaration's stored values the commas sit **inside** tokens: a value like
`0,1` is the last rider of one attachment glued to the `format` of the next. That is why
the value counts are 6, 11, 16, 21 (`1 + 5k`). To parse: join the values with spaces, split
the text on `,`, then split each part on whitespace.

`[INF]` A constructed example: `["1","4","1","0","2","0,1","4","0","2","1","1"]` → join →
`1 4 1 0 2 0,1 4 0 2 1 1` → two attachments, `1 4 1 0 2 0` and `1 4 0 2 1 1`.

| field | meaning |
|---|---|
| `format` | `ClipStrokeAttachment.currentFormat` = 1 `[BIN] CoreGlyphsLib @0x151FC` |
| `flags` | `ClipStrokeAttachmentFlags`: 1 `ignoreTranslation`, 2 `ignoreRotation`, 4 `hasStartProgress` `[BIN] CoreGlyphsLib` (getters `@0x151FC`, `@0x15208`, `@0x351F8`) |
| `targetLayer` | the **family layer** whose drawing tip is followed ([06](06-drawing.md) §6.2) |
| `targetSubpath` | a subpath of that family layer, in that layer's own numbering |
| `dataIndex` | an entry of `data-d` ([06](06-drawing.md) §6.3) |
| `rider_i` | subpaths of the **declaring** family layer that ride the tip |

`[CAR]` Every attachment on `26A5416b` has `format` 1, `flags` 4 and exactly one rider. All
fields are non-negative integers. `[INF]` A `format` other than 1, one to five fields in an
attachment, or a field that is not a non-negative integer, is an error, not a guess. An
**empty** part (no fields at all, e.g. after a trailing `,`) is skipped: a comma separates
attachments, so nothing between two separators is no attachment rather than a short one.

### 5.3 `-sfsymbols-clear-behind`: the knockout

`[CAR]` `clear-behind: true` is the knockout: the layer is composited as an erase
(destination-out), cutting through what was drawn before it. A renderer that only fills
draws `speaker.wave.2.circle.fill`'s disc solid. `[BIN] CoreUI 26A5416b` The runtime side
is `-[CUINamedVectorGlyph isKnockoutEnabledForHierarchicalLayerAtIndex:opacity:]` and its
multicolor and palette siblings, which is consistent with the per-mode rules of §2.4.

### 5.4 Properties that are local strings

`[CAR]` `-sfsymbols-wiggle-angle`, `-sfsymbols-has-fill-images` and
`-sfsymbols-fill-image-names` are not among the 89 atoms: they are local strings in each
document's own pool, matched by their text ([02](02-bvg-document.md) §3). The two
fill-image properties occur on three documents in the whole catalog and nothing reads them.

### 5.5 Boolean meaning of the per-document properties

`[CAR]` `-sfsymbols-draw-reverses-motion-groups` is declared on every document. `[BIN]
RenderBox 26A5416b` It is read by one function, `draw_timing_groups` (`0x1A789EA50`), so it
belongs to the Draw effect alone: Draw chains the motion groups from the highest down when
it is `true`.

`[CAR]` `-sfsymbols-vc-continuous: true` (51 identifiers) marks symbols whose variable
value is continuous rather than stepped.

## 6. What the style block does not carry

- **No `fill-rule`.** `[CAR]` No `fill-rule`, `evenodd` or `nonzero` string exists in any of
  the 36,975 documents' pools. Winding is **nonzero**; holes are reversed subpaths or
  `clear-behind` layers.
- **No weight.** The weights are renditions ([01](01-bom-and-car.md) §5.2).
- **No hierarchical opacities.** The block gives each layer a role; what a role is worth
  is the palette's ([05](05-metadata.md) §3.5).
- **No timing.** No duration, spring or travel distance is stored per symbol.
