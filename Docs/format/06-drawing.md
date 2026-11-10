# 06 — From a document to a `Drawing`

How a decoded `BVG ` document ([02](02-bvg-document.md)–[04](04-style-block.md)) becomes
OpenSymbols' `Drawing`: one value that carries every layer's geometry, its paint in all four
rendering modes, and every animation parameter the symbol ships. Where this document says
"the format", it states Apple's facts; where it says "the model", it states how OpenSymbols
holds them. Choices that are the model's and not Apple's are sealed `[INF]`.

## 1. The model, field by field

### 1.1 `Drawing`

| field | type | from | § |
|---|---|---|---|
| `viewBox` | `[x, y, w, h]` | `viewBox` on the root `svg` | 2.1 |
| `transform` | 6 numbers `a b c d e f` | `transform` on `<g id="s">` | 2.2 |
| `layers` | `Layer[]` | one per shape node, document order | 3 |
| `drawReversesMotionGroups` | boolean | `.defaults`: `-sfsymbols-draw-reverses-motion-groups` | 5.2 |
| `variableValueMode` | `color` \| `draw` | `.defaults`: `-sfsymbols-variable-value-mode` | 5.2 |
| `vcContinuous` | boolean | `.defaults`: `-sfsymbols-vc-continuous` | 5.2 |
| `wiggleStyle?` | `linear` \| `clockwise` \| `counterClockwise` | `.defaults`: `-sfsymbols-wiggle-style` | 5.2 |
| `wiggleAngle?` | number (degrees) | `.defaults`: `-sfsymbols-wiggle-angle` (local string) | 5.2 |
| `rotatesClockwise?` | boolean | `.defaults`: `-sfsymbols-rotates-clockwise` | 5.2 |
| `shapeGroups` | `{layer, fillAction?, indices}[]` | `.shapeGroupLayer-N` classes, whole tree | 7 |
| `drawAttachmentData` | `{a, b, anchorX, anchorY}[]` | `data-d` on the node with id `da` | 6.3 |
| `rotationAnchor?` | `[x, y]`, path space | the `<circle id="ra">` marker | 9.2 |
| `metricCenter?` | `[x, y]`, path space | the glyph metrics (TLV 1018) | 9.3 |

### 1.2 `Layer`

| field | type | from | § |
|---|---|---|---|
| `path` | path commands | the node's `d`, or its `circle` geometry | 3.2, 3.3 |
| `modes` | `LayerStyle` per mode: `monochrome`, `hierarchical`, `multicolor`, `palette` | the node's painted class of each mode, and its `fill` | 4.4, 4.5 |
| `role` | `primary` \| `secondary` \| `tertiary` | the hierarchical class's value | 4.3 |
| `motionGroup` | integer | structural class: `-sfsymbols-motion-group` | 5.1 |
| `tags` | string[] | structural class: `-sfsymbols-layer-tags` | 5.1 |
| `variableThreshold?` | number | structural class: `-sfsymbols-variable-threshold` | 5.1 |
| `variableDraw?` | `[a, b]` | structural class: `-sfsymbols-variable-draw` | 5.1 |
| `alwaysRotates` | boolean | structural class: `-sfsymbols-always-rotates` | 5.1 |
| `alwaysPulses` | boolean | structural class: `-sfsymbols-always-pulses` | 5.1 |
| `strokeKeyframes` | `{flags, progress, d0, d1}[]` | the node's `data-clipstroke-keyframes` | 6.1 |
| `familyLayer` | integer, −1 = none | the structural class's layer number `N` | 4.2 |
| `attachments` | `{flags, targetLayer, targetSubpath, dataIndex, riders[]}[]` | structural class: `-sfsymbols-clipstroke-attachments` | 6.2 |

`LayerStyle` is how the layer is drawn in one rendering mode:

| field | type | from | § |
|---|---|---|---|
| `paint` | `Paint` | the mode class's value, and the node's `fill` in multicolor | 4.4 |
| `opacity` | number | the painted class's `opacity` declaration, or the node attribute | 4.5 |
| `clearBehind` | boolean | the painted class's `-sfsymbols-clear-behind` | 4.5 |

`Paint` is one of `tint`, `role(r)`, `named(colourName)`, `fixed(hex)`, `none` (§4.4).

Paint, opacity and the knockout are per mode because the format makes them so (§4.5): one
`Drawing` carries all four readings, and a consumer never re-decodes per mode.

## 2. The document frame

### 2.1 Root and `viewBox`

`[CAR]` The root node is `svg` (tag 0) and carries `viewBox`, a numeric list of exactly four
numbers `x y w h`, in points ([02](02-bvg-document.md) §5.2). `[INF]` A root that is not `svg`,
or a `viewBox` without exactly four numbers, is malformed.

### 2.2 The transform group

`[CAR]` The drawing group is the `g` node whose id is `s` (atom 63). Its `transform` is
`matrix(a b c d e f)` ([02](02-bvg-document.md) §5.3), the SVG affine
`x' = a·x + c·y + e`, `y' = b·x + d·y + f`, which maps path coordinates (the space the `d`
data is written in) to viewBox points. On `wifi` it is a uniform scale of about 1/157 with
a translation.

`[INF]` Find it by a depth-first, pre-order search from the root; the first `g` with id `s`
wins. A document without one, or a `transform` that does not hold exactly six numbers
separated by spaces or commas, is malformed.

**The model stores `transform` and does not apply it.** Every layer's `path` stays in path
coordinates; consumers apply the matrix.

## 3. Layers

### 3.1 One layer per shape node, in document order

`[INF]` Walk the node tree depth-first, pre-order, from the root, visiting children in their
stored order. Every **shape node** ([02](02-bvg-document.md) §4.4: tags 3–9) yields exactly one
`Layer`, in the order met; the walk does not descend into a shape node's children. A
`circle` **without `r`** is a marker (§9.2), not a shape: it yields no layer.

`[CAR]` Shape nodes sit under `<g id="s">`; the `LayerTree` subtree (§7) holds none. The
walk covers the whole tree anyway, so a shape placed elsewhere by a future build is not
lost.

The model's layer is **one shape node**. Apple's renderer groups nodes into **family layers**
(§4.2); several model layers can belong to one family layer.

### 3.2 `path` from `d`

`[BIN]` The node's `d` attribute (name index 22) is a path blob, decoded per
[03](03-bvg-paths-and-numbers.md) §3 into SVG commands. `[INF]` A `path` node without `d`, or
whose `d` does not decode, is malformed.

### 3.3 `path` from a `circle`

`[CAR]` A drawn `circle` carries `cx`, `cy` and `r` as plain numeric strings. `[INF]` A
`circle` with `r` but without `cx` or `cy` is malformed (it would otherwise draw at the
origin). It becomes a closed path of four cubic arcs from `(cx+r, cy)` through
`(cx, cy+r)`, `(cx-r, cy)` and `(cx, cy-r)` back to the start, with `k = 0.5522847498`:

```
M  cx+r      cy
C  cx+r      cy+r·k     cx+r·k    cy+r      cx        cy+r
C  cx-r·k    cy+r       cx-r      cy+r·k    cx-r      cy
C  cx-r      cy-r·k     cx-r·k    cy-r      cx        cy-r
C  cx+r·k    cy-r       cx+r      cy-r·k    cx+r      cy
Z
```

`[INF]` This is the standard four-arc approximation, not a conversion read from CoreUI; its
radial error is under 0.03 % of `r`. `[OBS]` How CoreUI turns a `circle` into a path is not
read.

### 3.4 Other shape tags

`[CAR]` No document carries `rect`, `ellipse`, `line`, `polyline` or `polygon` geometry
([02](02-bvg-document.md) §4.4). `[INF]` Such a node has no `d` and is therefore reported as
malformed (§3.2) rather than silently dropped.

### 3.5 Path integrity

`[INF]` Every layer's `path` is checked once built. A command's argument count must be a
multiple of its op's arity: `M m L l T t` 2, `C c` 6, `S s Q q` 4, `H h V v` 1, `Z` none.
A multiple, because one command carries every step of its runs
([03](03-bvg-paths-and-numbers.md) §3.5: values are appended in pairs, whatever the arity);
zero is a multiple, because a command whose runs decoded nothing is still emitted
([03](03-bvg-paths-and-numbers.md) §3.6). Every argument must be a finite number. A
violation is an error naming the layer index and the command index: a half step means the
stream was misread or cut short, and drawing it would be a guess.

## 4. Classes and paint

### 4.1 Selecting a class of a kind

`[INF]` To find a node's class of a given family kind (`0x80`–`0x83`), scan the node's class
indices **in stored order** and take the **first** whose class has that kind. Later classes of
the same kind are ignored. A class index that names no entry of the class list is
malformed. `[CAR]` This matters on 1,206 shape nodes that carry two or more
monochrome classes ([04](04-style-block.md) §2.3).

The **mode class** of a rendering mode is the node's class of kind:

| mode | kind |
|---|---|
| monochrome | `0x80` `.monochrome-` |
| multicolor | `0x81` `.multicolor-` |
| hierarchical | `0x82` `.hierarchical-` |
| palette | `0x82` `.hierarchical-` |

`[INF]` Palette reads the hierarchical class: the format has no palette prefix
([04](04-style-block.md) §2.2), and palette colours by role.

### 4.2 The structural class and `familyLayer`

`[INF]` The **structural class** is the node's monochrome class, else its multicolor class,
else its hierarchical class (§4.1 for each). It is independent of the rendering mode, and it
is where every structural declaration (motion group, tags, variable and animation
properties, attachments) is read.

`[CAR]` The fallback across kinds is needed: on the private symbol `spatial`, three of four
shape nodes carry only `.multicolor-N:tintColor` and `.hierarchical-N:tertiary`, no
monochrome class. Where several family classes exist, they carry the same motion group and
tags on every document measured, so the priority changes no value there.

**`familyLayer`** is the structural class's `layer` number `N`, or −1 when the node has no
family class. It names the node's family layer, the unit Apple's renderer animates and the
numbering that attachments use (§6.2).

### 4.3 `role`

`[CAR]` The hierarchical class's value is the role: `primary`, `secondary` or `tertiary`.
`[INF]` A node without a hierarchical class has role `primary`. A hierarchical value outside
the three, or a hierarchical class with no value (`0xFF`), is an unknown value (§8).

### 4.4 `modes[m].paint`

For each mode `m`:

| mode | `modes[m].paint` |
|---|---|
| monochrome | `tint` |
| hierarchical | `role(role)` if the node has a hierarchical class, else `tint` |
| palette | same as hierarchical |
| multicolor | `fixed(hex)` if the node has a `fill` attribute `#RRGGBB`; else, if it has a multicolor class, `tint` when its value is `tintColor` and `named(value)` otherwise; else `tint` |

Evidence and seals:

- `[CAR]` Monochrome draws every layer in the tint; the monochrome class carries no colour
  (its value is always `0xFF`).
- `[CAR]` `fill="#RRGGBB"` belongs to **multicolor only**: every shape node with a `fill`
  also carries a `.multicolor-N:custom` class whose rule repeats that `fill`
  ([02](02-bvg-document.md) §5.6). The attribute is that rule written on the node. Applying it
  in monochrome paints, for example, `paintpalette`'s palette in its multicolor tan
  (`#DDB891`) where the monochrome drawing is all tint. `[INF]` `hex` is kept as written
  (`#` and six hex digits, either case); anything else in a `fill` starting with `#` is
  malformed. A node `fill` that does not start with `#` is not a literal colour and is
  ignored for paint: the multicolor class decides. A `fill` declared in a rule must be
  `#RRGGBB` as well (it repeats the node's colour, [02](02-bvg-document.md) §5.6), but only
  the node attribute is read for paint.
- `[CAR]` A multicolor value is a colour name (`systemBlueColor`, `white`, `black`,
  `labelColor`, `knockout`, `custom`, local names, …), resolved against a palette
  ([05](05-metadata.md) §3.5). `tintColor` is the user's tint, so it is `tint`, not a name.
  `[INF]` `custom` without a `fill` stays `named("custom")`. A multicolor class with no
  value (`0xFF`) names no colour and is malformed.
- `[INF]` A node without the mode's class takes `tint` in that mode.
- `none` is **reserved**: no rule above produces it, and no document on `26A5416b` needs it
  `[CAR]` (every shape node gets one of the other four kinds in every mode). It exists in the
  model so that a future build's unpainted-in-one-mode layer has a value; a decoder of this
  build never emits it.

### 4.5 `modes[m].opacity` and `modes[m].clearBehind`

`[CAR]` how a layer is composited — its `opacity` and whether it is a
knockout (`-sfsymbols-clear-behind`) — is **per mode**. Both are declared on the family
classes, and the three family classes of one node do not always agree
([04](04-style-block.md) §2.4: 9,942 nodes in 9,411 documents). For a given mode they are
read from the **painted class**: the mode class if the node has one (§4.1), else the
structural class (§4.2).

This is the model's rule, per mode `m`:

- `modes[m].clearBehind` is `m`'s painted class's `-sfsymbols-clear-behind` (absent =
  `false`).
- `modes[m].opacity` is `m`'s painted class's `opacity` declaration (property atom 20;
  absent = 1).
- Only when the node has **no** family class at all is the node's own `opacity` attribute
  used. `[CAR]` The attribute is never independent data: every node carrying it has a class
  declaring an opacity, and on 330 nodes it repeats a class other than the monochrome one
  (`lungs.fill` carries `0.6`, its `.multicolor-1:white`'s, where `.monochrome-1` says
  `0.0`; `faceid` carries `0.5`, its multicolor class's, where the monochrome class
  declares none). Letting the attribute win draws those symbols wrong.

`[CAR]` What the per-mode rule preserves: on `speaker.wave.2.circle.fill`,
`modes.monochrome.clearBehind` is `true` with opacity 0 (the speaker is cut through the
disc), while `modes.hierarchical` and `modes.multicolor` have `clearBehind = false` and
opacity 1 (the speaker is drawn, primary on the tertiary disc, white on the pink one).
Palette uses the hierarchical class, so it reads like hierarchical.

## 5. The `-sfsymbols-*` properties

`[BIN]` Properties are dispatched by **string index** against the atom table
([02](02-bvg-document.md) §3), except `-sfsymbols-wiggle-angle`, which is a local string and
is matched by **text** ([04](04-style-block.md) §5.4).

### 5.1 Per layer — from the structural class's rule

| property | atom | field | rule |
|---|---:|---|---|
| `-sfsymbols-motion-group` | 34 | `motionGroup` | exactly one value, an integer; absent → 0 |
| `-sfsymbols-layer-tags` | 36 | `tags` | every value, in order; absent → `[]` |
| `-sfsymbols-variable-threshold` | 35 | `variableThreshold` | exactly one number; absent → unset |
| `-sfsymbols-variable-draw` | 45 | `variableDraw` | exactly two numbers, kept in order; absent → unset |
| `-sfsymbols-always-rotates` | 37 | `alwaysRotates` | boolean; absent → `false` |
| `-sfsymbols-always-pulses` | 41 | `alwaysPulses` | boolean; absent → `false` |
| `-sfsymbols-clipstroke-attachments` | 46 | `attachments` | §6.2; absent → `[]` |
| `-sfsymbols-clear-behind` | 42 | `modes[m].clearBehind` | from each mode's **painted** class, §4.5 |
| `opacity` | 20 | `modes[m].opacity` | from each mode's **painted** class, §4.5 |

`[CAR]` These are declared on family classes that drawn shape nodes reference: variable
threshold reaches 7,188 layers, variable draw 3,639, always pulses 22,272, always rotates
3,324. `[INF]` A count other than the one stated (for the single-valued ones, other than one)
is malformed ([04](04-style-block.md) §3.2). A property declared twice in one rule takes its
last declaration ([04](04-style-block.md) §3.5).

`[INF]` Every rule that some class points at is read and validated once, up front, whether
or not a shape node reaches it, so an unknown property or value anywhere in the style block
is reported (§8). A rule no class points at ([04](04-style-block.md) §1.2) is not read.

### 5.2 Per document — from `.defaults`

`[CAR]` `.defaults` is the one class of the named kind (`kind & 0x80 == 0`) whose value is
atom 52; no node references it ([04](04-style-block.md) §2.3).

| property | atom | field | rule |
|---|---:|---|---|
| `-sfsymbols-variable-value-mode` | 39 | `variableValueMode` | `color` \| `draw` |
| `-sfsymbols-draw-reverses-motion-groups` | 38 | `drawReversesMotionGroups` | boolean; absent → `false` |
| `-sfsymbols-vc-continuous` | 40 | `vcContinuous` | boolean; absent → `false` |
| `-sfsymbols-wiggle-style` | 47 | `wiggleStyle` | `linear` \| `clockwise` \| `counterClockwise`; absent → unset |
| `-sfsymbols-wiggle-angle` | local | `wiggleAngle` | one number; absent → unset |
| `-sfsymbols-rotates-clockwise` | 48 | `rotatesClockwise` | boolean; absent → **unset**, which is not `false` |

`[CAR]` Variable value mode and draw-reverses-motion-groups are declared on every document.
`[INF]` A document without `-sfsymbols-variable-value-mode` is malformed: the field has no
neutral value.

`[CAR]` `.defaults` also carries `-sfsymbols-has-fill-images` and
`-sfsymbols-fill-image-names` on three documents. They are not surfaced (§8).

### 5.3 Per shape group

`-sfsymbols-fill-action` (atom 43) and `-sfsymbols-indices` (atom 44): §7.

### 5.4 What the values mean

The model decodes; it does not animate. For readers of the fields:

- `motionGroup` — the partition the Bounce, Pulse and Wiggle effects animate by. `[CAR]`
  Two groups is the norm (26,811 of 36,975 documents); one group animates as a whole.
- `variableThreshold` — in `color` mode, the layer lights up once the variable value passes
  it. `[CAR]`
- `variableDraw` — the pair used in `draw` mode; meaning open ([04](04-style-block.md) §4.5).
- `drawReversesMotionGroups` — Draw chains groups from the highest down
  ([04](04-style-block.md) §5.5).

## 6. Draw data

The Draw effect cuts each layer's filled outline progressively. Its data is per node
(`data-clipstroke-keyframes`), per family layer (`-sfsymbols-clipstroke-attachments`) and per
document (`data-d`).

### 6.1 `strokeKeyframes` — `data-clipstroke-keyframes`

`[BIN] CoreUI 26A5416b` `+[NSData(ClipStrokeKeyframes)
encodedClipStrokeKeyframesFromString:subpathOffset:]` (`0x18B52CACC`) reads the attribute as
whitespace-separated tokens; token 0 is a version:

```
version 0:  0  { flags progress d0 d1 }*                       one keyframe set
version 1:  1  m  c_0 … c_{m-1}  { flags progress d0 d1 }*     m keyframe sets
```

In the document the attribute is a numeric list (name index 61), so its decoded values are
already these tokens as numbers.

Each record is `{u32 flags; f32 progress; f32 d0; f32 d1}`; CoreUI adds a `subpathOffset` to
`d0` and `d1` that shifts the node's subpath numbering into its layer's.

- **`d = subpath + fraction`** `[BIN] CoreGlyphsLib (SF Symbols app 8) @0xAD80–0xADF4`. The
  integer part picks a subpath, counted from the node's first moveto; the fraction is a
  position along that subpath as a fraction of its **arc length**, starting at its moveto and
  following the path's direction, the implicit closing segment included. `[CAR]` Checked on
  `wifi`'s outer arc: the pair `0.72917 / 0.230054` lands on the symmetry axis to within
  two units of a ~2,000-unit glyph.
- **`progress`** is the Draw progress, 0 → 1, at which the outline is cut at `d0` and `d1`.
- **`flags`** is `RawClipStrokeKeyframeFlags` `[BIN] CoreGlyphsLib`: 1 `corner`, 2 `lineCap`,
  4 `invertJoined`, 8 `bisectionPoint`.

`[CAR]` 10,527 documents, 14,523 nodes, 69,543 records, **all version 0**. `floor(d) <` the
node's own subpath count on every position, and every fraction is in `[0, 1]`.

`[CAR]` By flag: 0 on 60,574 records; `invertJoined` 5,529 (all at progress 0, all with `d0`
and `d1` on adjacent subpaths); `bisectionPoint` 3,230 (all at progress 0); `lineCap` 165
(all at progress 0); `corner` 45 (all strictly between 0 and 1).

**The model** `[INF]`: a layer is one node, so the subpath offset is 0 and `d0`, `d1` are kept
as written (node-local numbering). For version 0, the values after the version must be a
multiple of four, else the attribute is malformed; each record must have `flags` a
non-negative integer below 2^32, finite `progress`, and `d0`, `d1` ≥ 0. `[INF]` A version
other than 0 is an error naming the version: no such document exists to test against, and
a new build's change must surface rather than silently drop a layer's stroke animation. A
node without the attribute has `strokeKeyframes = []`.

`[OBS]` A second census over the same catalogs counted the attribute on 4,230 documents
rather than 10,527; the two populations were not reconciled.

### 6.2 `attachments` — `-sfsymbols-clipstroke-attachments`

Parsed from the structural class's declaration per [04](04-style-block.md) §5.2 into
`{flags, targetLayer, targetSubpath, dataIndex, riders}`; `format` is checked (must be 1)
and not stored.

`[BIN] RenderBox 26A5416b` `resolve_draw_attachments` (`0x1A782116C`) and
`resolve_draw_transforms` (`0x1A7825014`): an attachment makes subpaths of the declaring
family layer (the `riders`, e.g. an arrowhead) ride the drawing tip of subpath
`targetSubpath` of family layer `targetLayer`, with the hook described by `data-d` entry
`dataIndex` (§6.3).

**Numbering.** `[CAR]` `targetLayer` is a **family layer** number (the `N` of the family
classes, `familyLayer` in the model, §4.2). `targetSubpath` and every rider are subpath
indices **within a family layer**, counted across that family's shape nodes in document
order, before any joining of subpaths. Measured that way, on every attachment of
`26A5416b`: `targetLayer` exists, `targetSubpath` is below the target family's subpath
count, and each rider is below the declaring family's subpath count. `[CAR]` `dataIndex` is
below the `data-d` entry count on 9,312 of 9,357 attachments; `[OBS]` what the 45 others
point at is not known.

**The model** `[INF]`: every node of a family carries the same family class, so every model
layer of that family repeats the same `attachments`; a consumer takes them from the
family's first layer.

`[INF]` Worked example, `arrow.left.to.line`: `1 4 0 2 0 1` with `data-d = "0 1 0 3.643 3.809"`
is format 1, flags 4 (`hasStartProgress`), target family layer 0, its subpath 2 (the shaft),
data entry 0, rider subpath 1 of the declaring family layer 0 (the chevron): the chevron
rides the shaft's tip, hooked at progress 1, present from progress 0.

### 6.3 `drawAttachmentData` — `data-d`

`[CAR]` On the node whose id is `da` (atom 65), an attribute named `data-d` (a local string,
matched by text) whose value is literal text ([02](02-bvg-document.md) §5.4):

```
data-d := "0" { a b anchorX anchorY }*
```

`[BIN] RenderBox 26A5416b` (`resolve_draw_attachments`, `0x1A782116C`):

| field | meaning |
|---|---|
| `a` | the progress of the target keyframe the rider hooks to (records within 1e-4 of `a`) |
| `b` | the rider's start progress: it is hidden until the tip reaches `b` |
| `anchorX`, `anchorY` | a reference point, y up, used to break ties when several target keyframes sit at `a` |

`[CAR]` `(a, b) = (1, 0)` is the common case: the rider hooks to the stroke's end and is
present from the start; most others have `a = 1` and `b` between 0.28 and 0.45.

**The model** `[INF]`: find the first node in depth-first pre-order with id `da` that has a
`data-d` attribute. Split its text on spaces and commas. `[INF]` If there is no token, or the
first token is not `0`, it is an error naming the version: version 0 is the only one seen,
and a new build's change must surface rather than silently drop the attachments' hooks.
Otherwise the remaining tokens must be a multiple of four finite numbers, read in order into
`{a, b, anchorX, anchorY}`; anything else is malformed. A document without such a node has
`drawAttachmentData = []`.

## 7. Shape groups

`[CAR]` 44 identifiers are shape-group symbols. They carry a second, geometry-free tree:
a `<g id="LayerTree">` sibling of `<g id="s">`, whose `g` nodes hold family and
`.shapeGroupLayer-N` classes, while `<g id="s">` draws **one merged `path` with no class**
(`flag.slash.circle.fill` is the canonical case). No shape node in any document can reach
`-sfsymbols-fill-action` or `-sfsymbols-indices`; on `Layer` both would be empty on every
layer, which is why they live on `Drawing`.

**The model** `[INF]`: walk the **whole** tree, depth-first, pre-order (not stopping at shape
nodes). For every node, for every class index of kind `0x83` in stored order, append one
`ShapeGroup`:

| field | from |
|---|---|
| `layer` | the class's `layer` number `N` |
| `fillAction?` | the class rule's `-sfsymbols-fill-action`: `draw` \| `erase`; absent → unset |
| `indices` | the class rule's `-sfsymbols-indices`, each value an integer, in order; absent → `[]` |

`[CAR]` 447 shape groups across both catalogs. `indices` holds 1 to 13 integers per
declaration. `[INF]` A declared `-sfsymbols-indices` with no value is malformed.

`[OBS]` What do `indices` index, and what does `fill-action: erase` erase? The merged path's
subpaths are the natural reading; not established.

## 8. Errors

`[INF]` One policy, so that a new build's changes are seen:

- **Unknown property** — a `-sfsymbols-*` name outside the census of
  [04](04-style-block.md) §4.1, or a CSS property other than `opacity` and `fill`: an error
  naming it, so that a new build's vocabulary surfaces rather than being skipped. The two
  census properties that nothing reads (`-sfsymbols-has-fill-images`,
  `-sfsymbols-fill-image-names`) are accepted and not surfaced.
- **Unknown value on a known property** with a closed vocabulary
  ([04](04-style-block.md) §4.2) — e.g. `-sfsymbols-wiggle-style: zigzag`, or
  `-sfsymbols-always-rotates: 1` where only `true`/`false` are booleans: an error naming the
  property and the value.
- **Wrong value count** on a known property, a number that does not parse, a missing `d`, a
  half-specified `circle`, a malformed `transform`, `viewBox`, keyframe list, attachment or
  `data-d`: an error naming the field.
- **Unknown version** of `data-clipstroke-keyframes` (§6.1) or `data-d` (§6.3): an error
  naming the version.
- **A path that does not fit its ops** (§3.5): an error naming the layer and command.

A number "parses" only if the whole token is a number; a numeric prefix followed by other
characters is not a number.

## 9. Glyph metrics and the animation pivots

The glyph metrics, and the two points every effect turns and scales about
([07](07-effects.md) §2.5): the rotation anchor and the metric centre. Both points are
stored in **path space** (the coordinates of the layers' `path`, before `transform`),
where an effect's per-layer transform acts.

### 9.1 Glyph metrics

`[CAR]` Every vector rendition checked carries TLV type 1018 in its `csiheader` TLV section
([01](01-bom-and-car.md) §3.8), at least 36 bytes, little-endian words in viewBox units:

```
offset  0  u32 7 [OBS]
        4  u32 referencePointSize
        8  f32 baselineOffset
       12  f32 capHeight
       16  f32 (6 or 7) [OBS]
       20  f32 leftInset
       24  f32 (0.888672) [OBS]
       28  f32 rightInset
       32  f32 (0.888672) [OBS]
       36+ [OBS]
```

`[INF]` A reader takes the five named fields at those offsets. An entry shorter than 36 bytes
yields no metrics (a note with a reason; the rendition is kept). A rendition without a 1018
entry has no metrics. When a section holds two 1018 entries the first wins.

`[INF]` The field identities, each from a relation that holds on every rendition checked
(`wifi`, `apple.intelligence`, `gear`, `heart.fill`, `arrow.clockwise`,
`square.and.arrow.up`, three masters each): `transform`'s scale = `referencePointSize /
2048`; `transform`'s `f` = viewBox height − `baselineOffset`; `transform`'s `e` =
−`leftInset`; `capHeight` 9.15967 at 13 pt = 1,443 path units; `rightInset` ≈ `leftInset` on
symmetric glyphs. `[OBS]` The unnamed words.

### 9.2 Rotation anchor

**What Apple reads.** `[BIN] CoreUI 1010 / 26A5416b` `-[CUINamedVectorGlyph rotationAnchor]`
(block 0x18B4A297C) calls `_getAnchor:@"ra" inRendition:` (0x18B4A2428; the CFString at
0x1E8982350 is `"ra"`), which looks the anchor up in the rendition's SVG document; with it
present it returns its point, without it it falls back to `_getMetricCenterInRendition:`
(§9.3). The three masters are interpolated (`_interpolatedAnchorWithWeight:…`). `[BIN]
RenderBox 8.0.84 / 26A5416b` stores the result as the glyph's `layer-rotation` pivot
(`glyph[+0x68]`, constructor 0x1A781FAF8–0x1A781FB68, y replaced by `alignmentHeight − y`),
the same point for every layer.

**In the document.** `[CAR]` A `circle` with id `ra` (atom 64) carrying `cx` and `cy` but
**no `r`**: a marker, not a shape (§3.1). On `apple.intelligence` it is a child of `svg`.

**The model** — `Drawing.rotationAnchor?: [x, y]`, path space:

1. `[INF]` Find the first node, depth-first pre-order from the root, that is a `circle` with
   id `ra`, no `r`, and both `cx` and `cy` parsing as numbers. None → unset.
2. Whether it lies **inside** `<g id="s">` (a descendant of the transform group of §2.2)
   decides its frame:
   - inside: `(cx, cy)` is already in path space;
   - outside (the observed case): `(X, Y) = (cx, cy)` is in viewBox units and maps into path
     space through the inverse of `transform = (a b c d e f)`:

     ```
     det = a·d − b·c
     x   = ( d·(X − e) − c·(Y − f)) / det
     y   = (−b·(X − e) + a·(Y − f)) / det
     ```

     A singular transform (`det = 0` or not finite) leaves the anchor unset.
3. `[INF]` No y flip: the marker is read in SVG coordinates (y down, like the viewBox and
   path space); CoreUI's y-up point and RenderBox's `alignmentHeight − y` cancel out.
4. Per master: each master's document carries its own marker; a consumer interpolating
   masters interpolates the anchor like any other coordinate `[INF]` (CoreUI does,
   above).
5. Unset → consumers use the metric centre (§9.3), as CoreUI does.

Worked example `[INF]`: `transform = (0.01 0 0 0.01 −1 18)`, marker `cx = 10, cy = 11` under
`svg` → path `((10 + 1)/0.01, (11 − 18)/0.01) = (1100, −700)`.

### 9.3 Metric centre

**What Apple reads.** `[BIN] CoreUI 1010 / 26A5416b` `-[CUINamedVectorGlyph metricCenter]`
(0x18B4A2634) returns an explicit value × `_requestedPointSizeRatio` when the glyph has one
`[OBS]` (where that value comes from is not read); otherwise `_getMetricCenterInRendition:`
(0x18B4A25B8):

```
x = (d1 + canvasSize.width + d3) · 0.5 − d1          d1, d3: vectorGlyphAlignmentRectInsets (left, right)
y = vectorGlyphCapLine · 0.5 + vectorGlyphBaseline
```

`[BIN] RenderBox 8.0.84 / 26A5416b` stores it as the pivot of `scale` and `symbol-rotation`
(`glyph[+0x58]`, constructor 0x1A781FA60–0x1A781FAF4), y replaced by `alignmentHeight − y`
and x **mirrored** for a right-to-left glyph `[OBS]` (the mirror's formula).

**The model** — `Drawing.metricCenter?: [x, y]`, path space, from the glyph metrics of §9.1
and the viewBox `[vx, vy, w, h]`:

```
x_vb = vx + (leftInset + w + rightInset) / 2 − leftInset      the middle of the advance box
yUp  = capHeight / 2 + baselineOffset                          halfway up the cap height
y_vb = vy + h − yUp                                             y measured up from the bottom edge
(x, y) = transform⁻¹ (x_vb, y_vb)                               as in §9.2
```

`[INF]` The identifications: `canvasSize.width` is the viewBox width; the insets are §9.1's
`leftInset` / `rightInset`; the cap line is `capHeight` and the baseline `baselineOffset`,
both measured **up** from the viewBox's bottom edge (the frame `baselineOffset` is measured
in, §9.1: `transform.f = h − baselineOffset`). `[OBS]` Both frames are inferred, not
read: for `x`, that CoreUI's `canvasSize.width` and alignment-rect insets are the viewBox
width and §9.1's insets, measured from the viewBox's left edge; for `y`, that the cap line
and baseline are measured up from its bottom edge.

- No 1018 metrics, or a singular `transform` → unset. Consumers then use `[INF]` the centre
  of the bounding box of every layer's on-curve points.
- Per master, like the anchor.

Worked example `[INF]`: viewBox `[0 0 20 20]`, `transform = (0.01 0 0 0.01 −1 18)`,
`leftInset = rightInset = 1`, `capHeight = 14`, `baselineOffset = 2`: `x_vb = (1 + 20 +
1)/2 − 1 = 10`, `yUp = 7 + 2 = 9`, `y_vb = 20 − 9 = 11`, path `(1100, −700)`.
