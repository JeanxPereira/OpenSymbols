# 07 — The symbol effects

How Apple animates a symbol: where the animation is decided, the shape every effect takes
(keyframe lists over a fixed table of timing curves), how motion groups stagger, and each
effect's keyframes, durations and options. The geometry of the Draw effect (how an outline
is cut along its stroke) is [08](08-draw-clip.md); this document gives Draw's timing.

Where this document says "Apple" or names an image, it states Apple's behaviour; where it
says "the model", it states how OpenSymbols holds it. A choice that is the model's and not
Apple's is sealed `[INF]` with the reason.

**Seals.** As in the [README](README.md). `[BIN]` claims name the image they were read in:

| short name | image | version | role |
|---|---|---|---|
| RenderBox | `/System/Library/PrivateFrameworks/RenderBox.framework` | 8.0.84, macOS `26A5416b` (arm64e shared cache) | builds and evaluates every symbol animation |
| Symbols | `/System/Library/Frameworks/Symbols.framework` | 204, `26A5416b` | the public `NSSymbol*Effect` classes; they only build options |
| CoreUI | `/System/Library/PrivateFrameworks/CoreUI.framework` | 1010, `26A5416b` | decodes the assets; anchors, metric centre, Draw data |
| SFSymbols | `/System/Library/PrivateFrameworks/SFSymbols.framework` | 204, `26A5416b` | metadata only |
| CoreGlyphsLib | the SF Symbols app 8 (beta) copy, arm64 slice, base 0 | — | carries a second copy of RenderBox's clip code |

Unless a line says otherwise, every address in this document is in **RenderBox 8.0.84 /
`26A5416b`**, and a table's address column carries that seal. Floating-point constants are
printed as the float32 stored in the binary (`0.1499999761581421`, not "0.15"); the
binary computes in float32 except where noted.

Nothing here was compared frame by frame against Apple's rendered output. `[OBS]`

## 1. Where the animation lives

### 1.1 The assets carry structure, not timing

`[CAR]` Over the 36,975 documents of the catalogs, no duration, curve, spring constant,
travel distance or stagger is stored per symbol. What the assets do carry is the
structure every effect is built on ([06](06-drawing.md) §5):

| effect | catalog data it reads |
|---|---|
| every by-layer effect | `motionGroup` per layer |
| Pulse, Breathe | `alwaysPulses` per layer |
| Rotate | `alwaysRotates` per layer, `rotatesClockwise`, the rotation anchor (06 §9.2) |
| Wiggle | `wiggleStyle`, `wiggleAngle` |
| Draw | `strokeKeyframes`, `attachments`, `drawAttachmentData`, `drawReversesMotionGroups` |
| Replace, Magic Replace | `tags` (the four underscore tags, §7.10) |
| Variable Color | `variableValueMode`, `variableThreshold`, `variableDraw`, `vcContinuous` |
| Scale, Bounce, Breathe, Rotate | the metric centre (06 §9.3) as pivot |

### 1.2 Not in SFSymbols, not in CoreUI

`[BIN] SFSymbols 204 / 26A5416b`: no animation vocabulary in its strings or symbol table,
and only five floating-point constants in its code, none of them an animation constant.
`[BIN] CoreUI 1010 / 26A5416b`: its time vocabulary is theme and control animation; it
decodes the Draw data and the anchors (§2.5, [08](08-draw-clip.md)) but holds no symbol
timing.

### 1.3 RenderBox animates; Symbols builds options

`[BIN]` Each public effect class in Symbols (`NSSymbolBounceEffect`, …) has
`-[… _rbOptionsMutable]`, which only fills an options dictionary. RenderBox's
`-[RBSymbolAnimator addAnimation:options:]` parses it (0x1A78FBE64–0x1A78FC57C) into one
32-bit **option word** (§8); every keyframe below is read in its `RB::Symbol::Animation`
family.

`[OBS]` A second build of RenderBox with the same version 8.0.84 (minos 14.0, shipped
inside Icon Composer 27.0-129) differs from the system one in exactly one effect's
constants: its Bounce rebounds to the fixed `1.10899997` in both directions (§7.1). This
document follows the system build.

## 2. The model of an animation

### 2.1 An effect is keyframe lists

`[BIN]` Every `RB::Symbol::Animation::*_keyframes` function builds its effect with three
calls:

| call | address | meaning |
|---|---|---|
| `KeyframeStorage::push_keyframes(header)` | 0x1A7928454 | opens a list: property, filter, index, start time |
| `KeyframeStorage::push_value(value, duration, curve)` | 0x1A792834C | a segment: from the previous value to `value` over `duration` s on `curve` |
| `KeyframeStorage::push_value(value)` | 0x1A79283D8 | the final value (stored as curve 0, duration −1) |

A stored value is 12 bytes `{u32 curve; f32 duration; f32 value}`; `push_value` stores
`max(duration, 0)` (0x1A792839C–0x1A79283AC).

**Evaluation** `[BIN]` (`Keyframes::eval`, 0x1A7927E80): subtract the list's start; walk
the segments; within segment `i` of duration `d_i`,

```
value(t) = v_i + (v_{i+1} − v_i) · curve_i(t_local / d_i)       (0x1A7927F1C–0x1A7927F30)
```

**The model** (a *track*): `{property, group, layer, filter, start, from, segments[]}`,
`segment = {duration, curve, to}`. `[INF]` Its value at `t`:

- `t < start` → `from`;
- otherwise walk the segments; a segment of duration 0 has already jumped at its own
  instant (the walk is right-continuous: at `t == start` a zero-duration first segment has
  jumped);
- past the last segment → its `to`;
- a non-finite `t` → `from`.

Notation below: `v0 →(d, cN)→ v1` means "from `v0` to `v1` in `d` seconds on curve `N`".

### 2.2 The header: which layers a list reaches

`[BIN]` A header carries a property id (low 5 bits), a layer **index mode** in bits 25–26
and an index, a start time, and a layer **filter** `(mask, value)`. `Animation::apply`
(0x1A789D344–0x1A789D3A4) admits a presentation layer when

```
((layer.flags | side) ^ value) & mask == 0
```

and, by index mode: 0 every layer; 1 the layer's compacted motion group (§4.1) equals the
index; 2 the layer's own index equals it; 3 `layer[+0x58]` equals it `[OBS]` (what that
field is). `side` is `0x100` for the source glyph of a Replace pair and `0x200` for the
destination (0x1A789D1E0 / 0x1A789D1E8), 0 otherwise.

**Layer flags** `[BIN]` (`[layer+0x68]`, set in the layer constructor 0x1A7821F3C–0x1A78223D4):

| bit | value | meaning | in the model |
|---:|---:|---|---|
| 0 | `0x1` | eraser layer (`isEraserLayer`) | `modes[m].clearBehind` of the painted mode `[INF]` |
| 1 | `0x2` | tag `_slash` | `tags` contains `_slash` |
| 2 | `0x4` | tag `_badge` | `tags` contains `_badge` |
| 3 | `0x8` | tag `_enclosure.stroke` or `_enclosure.fill` | either in `tags` |
| 4 | `0x10` | animates its stroke (§7.8, [08](08-draw-clip.md) §2) | strokable family |
| 6 | `0x40` | `-sfsymbols-always-pulses` | `alwaysPulses` |
| 7 | `0x80` | `-sfsymbols-always-rotates` | `alwaysRotates` |
| 10–17 | | hierarchy level | `role` (§2.7) |

`[BIN]` The four tags are RenderBox's predefined tags 1–4, interned by
`GlyphCache::GlyphCache` (0x1A781F540–0x1A781F5AC) from the strings `_slash`, `_badge`,
`_enclosure.stroke`, `_enclosure.fill`. `[CAR]` They are exactly the catalog's four
underscore tags: `_badge` on 7,941 layers, `_enclosure.stroke` 7,908, `_enclosure.fill`
5,154, `_slash` 1,611.

The model's filters, named:

| filter | Apple header | admits |
|---|---|---|
| `any` | mask 0 | every layer |
| `alwaysRotates` | mask `0x80`, value `0x80` | `alwaysRotates` layers |
| `alwaysPulses` | mask `0x41`, value `0x40` (header `0x20082C`) | `alwaysPulses` layers that are not erasers |
| `slash`, `badge`, `enclosure` | mask = value = the flag | layers with that tag |
| `notEnclosure` | mask `0x8`, value 0 | layers without an enclosure tag |
| `notStroke` | mask `0x11` (+`0x8`), value 0 | non-eraser layers that do not animate their stroke |

### 2.3 The properties and how each applies to a layer

`[BIN]` `Animation::apply` (0x1A789CED8) dispatches on `(property & 0x1f) − 1` (jump table
0x1A77EC974); names from `property_names` (0x1E139BCB8):

| id | name | handler | effect of the value `v` on the layer |
|---:|---|---|---|
| 1 | `alpha` | 0x1A789D5F4 | `alpha *= v` |
| 2 | `scale` | 0x1A789D604 | `scale = k · v` (an assignment; `k` in §2.4) |
| 3 | `scale-interpolant` | 0x1A789D58C | `scale = s + (k − s) · v` |
| 4 | `scale-badge` | 0x1A789D5C0 | `badgeScale = v` |
| 5 | `translation` | 0x1A789D51C | `offset += dir · v` (§2.6) |
| 6 | `symbol-rotation` | 0x1A789D640 | `symbolTurn += v` (radians) |
| 7 | `layer-rotation` | 0x1A789D650 | `layerTurn += v` (radians) |
| 8 | `variable-alpha` | 0x1A789D5EC | both alphas `= v` |
| 9 | `variable-alpha-max` | 0x1A789D6B0 | `[OBS]` |
| 10 | `variable-alpha-fade` | 0x1A789D540 | `alpha += (target − alpha) · v`, target 0 with option bit 29, else `0.3` |
| 11 | `variable-alpha-interpolant` | 0x1A789D66C | `[OBS]` |
| 12 | `pulse-alpha` | 0x1A789D460 | `alpha *= floor + (1 − floor) · v`; `floor` in §7.2 |
| 13 | `clip-alpha` | 0x1A789D428 | `alpha *= v`; `v ≤ 0` hides the layer |
| 14 | `stroke-start` | 0x1A789D3F4 | a layer that animates its stroke: the clip's start; any other: `alpha *= 1 − v` |
| 15 | `stroke-end` | 0x1A789D3F4 | a layer that animates its stroke: the clip's end; any other: `alpha *= v` |
| 16 | `stroke-attachment-scale` | 0x1A789D5DC | the rider scale ([08](08-draw-clip.md) §11.5) |

`[INF]` `scale` is an assignment in Apple; no effect in this document gives one layer two
`scale` lists at once, so the model may fold them as a product. The model folds alphas as
a product of the alpha-like properties (1, 12, 13, and 14/15 on a non-strokable layer).

`[BIN]` On an eraser layer `clip-alpha` also drives a second alpha (`[pl+0x24]`) that
RenderBox multiplies into the knockout (`Presentation::draw` 0x1A785A680–0x1A785A6A8).
`[INF]` The model scales the knockout by the same `alpha` as the layer.

### 2.4 The scale factor `k`

`[BIN]` `k` comes from the animator's **scale level**, a signed byte (`Model+0x6A`, set by
`-[RBSymbolAnimator setScaleLevel:]`, 0x1A790F570), read at 0x1A789D604–0x1A789D628:

| scale level | `k` |
|---|---|
| 0 | `1.0` |
| > 0 | `1.25` |
| < 0 | `0.5` |

Every effect but Scale (§7.6) runs at level 0, so `scale = v`.

### 2.5 Pivots and the order of composition

`[BIN]` `Presentation::Symbol::make_layers` (0x1A785755C) writes the **same three points**
into every presentation layer (0x1A78575A4–0x1A78575AC, 0x1A78577C0–0x1A78577C8); no layer
has a pivot of its own, by-layer effects included:

| property | pivot | source |
|---|---|---|
| `scale`, `scale-interpolant`, `symbol-rotation` | the glyph's **metric centre** | `glyph[+0x58]` = `-[CUINamedVectorGlyph metricCenter]`, [06](06-drawing.md) §9.3 |
| `layer-rotation` | the glyph's **rotation anchor**, else the metric centre | `glyph[+0x68]` = `-[CUINamedVectorGlyph rotationAnchor]`, 06 §9.2 |
| `scale-badge` | the centre of the union of the `_badge` layers' content bounds, else the metric centre | `glyph[+0x60]`, 0x1A78201B4–0x1A7820264 |

`[BIN]` `Presentation::Layer::transform` (0x1A7859460) composes, from the symbol matrix `M`:

```
point → S_badge(about badge centre) → R_layer(about anchor) → S(about centre)
      → R_symbol(about centre) → M → + offset
```

i.e. `M · T(c) · R(symbolTurn) · S(scale) · T(−c)` for scale and symbol rotation
(0x1A7859518–0x1A78595A4), `layer-rotation` about the anchor (0x1A78595AC–0x1A7859620),
`scale-badge` first (0x1A785962C–0x1A7859674), and the translation added to `M`'s
translation column, in the **output** space (0x1A78594B8–0x1A7859504).

**The model.** Pivots are in path space (06 §9.2, §9.3), where a layer's extra transform
acts before the document's `transform`. `[INF]` A drawing without a metric centre uses the
centre of the bounding box of all layers' on-curve points; without a rotation anchor, the
metric centre.

### 2.6 Units and directions

- **Rotation** `[BIN]`: radians; RenderBox's space is y-down, so a **positive angle turns
  clockwise on screen** (§7.5). In path space (also y-down, [06](06-drawing.md) §2.2) the
  rotation matrix for `θ` is `[cos θ, sin θ, −sin θ, cos θ, 0, 0]` (SVG `rotate`).
- **Translation** `[BIN]`: `v` is a multiple of the glyph's **point size**
  (`glyph[+0x20]` = `(float)-[CUINamedVectorGlyph pointSize]`, 0x1A781F954–0x1A781F960),
  so the offset is `v · pointSize` points, along the unit vector `dir` (§7.4), added in the
  output space. `[INF]` The viewBox is in points at `referencePointSize`
  ([06](06-drawing.md) §9.1), so the offset is `v · referencePointSize` viewBox units, and
  in path space it is that vector mapped through the inverse of the linear part of
  `transform`. Since `transform`'s scale is `referencePointSize / 2048` on every rendition
  checked, that is `v · 2048` path units along `dir`. A drawing without metrics uses the
  viewBox height as the point size `[INF]`.

### 2.7 Alpha, visibility, hierarchy levels

`[INF]` The model's per-layer result: `alpha` = the product above, clamped to `[0, 1]`
(to `[0, 1/levelOpacity]` for a hierarchical always-pulses layer, §7.2); `visible =
false` when a `clip-alpha` value is `≤ 0` or `alpha` is 0.

The hierarchy level of a layer is `[INF]` 1 for `primary`, 2 `secondary`, 3 `tertiary`
(RenderBox stores CoreUI's `hierarchyLevel`, 0x1A7822514–0x1A7822528; the numbering is not
read). `Model::alpha(n)` `[BIN]` (0x1A78007AC) is the client's opacity of level
`min(n, 3)`, `byte / 255`. `[INF]` The model uses the hierarchical paint opacities: level 1
`1.0`, level 2 `0.5`, level 3 `0.18` (light) or `0.25` (dark).

**Erasers while animating** `[INF]`. A static eraser (§2.2 flag 0) erases fully, whatever its own
opacity ([06](06-drawing.md) §4.5, §5.3). While an effect runs, the model's renderer moves the
eraser's mask copy with the layer's `transform` and gives it the layer's `alpha` as its
opacity, so an eraser that is fading in or out erases only partly. Whether RenderBox scales an
animated eraser by its alpha is not read.

### 2.8 Numeric precision

`[BIN]` RenderBox stores keyframe values, durations, curve control points and the clip
constants as **float32** (§2.1's 12-byte value; the `s`/`q` registers throughout the
family), and every value of this document printed with float32 digits is that float32
(the Draw data of [06](06-drawing.md) §6 is float32 too: `{u32; f32; f32; f32}`).

**The model's rule** `[INF]`: a constant or keyframe value that Apple stores as float32 is
rounded to float32 (`Math.fround`) where it is stored; arithmetic on it then runs in
double. Comparisons against thresholds (`1e-4`, `0.9999`, …, e.g. [08](08-draw-clip.md)
§6.3, §11.4) use those rounded values and the threshold's own float32 value
(`1e-4` is `9.99999974e-05`). Example: Draw Off's plateau `1 − 1e-4` is stored as the
float32 `0.99989998`, so the span `1 − 0.99989998 ≈ 1.0002e-4` is **not** below `1e-4`
([08](08-draw-clip.md) §12.3).

## 3. The timing curves

### 3.1 Evaluation

`[BIN]` `Keyframes::Value::interpolant(t)` (0x1A7927F58) takes `u = clamp(t / duration, 0,
1)` and indexes `RB::Symbol::(anon)::curve_defs` (0x1A79635D0): 42 entries
(`cmp w8,#0x29`) of 40 bytes, four control floats plus a precomputed polynomial. `(0,0,1,1)`
returns `u`; `(0.33,0,0.67,1)` has a polynomial shortcut; every other goes to
`RB::BezierTiming::eval_with_derivative` (0x1A7884098).

A curve is the cubic Bézier `(0,0), (x1,y1), (x2,y2), (1,1)`; its value at `u` is the `y`
of the point whose `x` is `u`. `[INF]` The model solves `x(s) = u` by Newton from `s = u`
with a bisection fallback (x is monotone since `x1, x2 ∈ [0,1]`), returns `u` for any curve
whose control points lie on the diagonal, clamps `u` to `[0,1]`, maps a non-finite `u` to
0, and treats an index past 41 as linear.

### 3.2 The table

`[BIN]` `curve_defs` @0x1A79635D0, in order; duplicated rows are duplicated in the binary.

| id | x1 | y1 | x2 | y2 |
|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 1 | 1 |
| 1 | 0.33 | 0 | 0.67 | 1 |
| 2 | 0.4 | 0 | 0.6 | 1 |
| 3 | 0.55 | 0 | 0.67 | 1 |
| 4 | 0.45 | 0 | 0.67 | 1 |
| 5 | 0.25 | 0 | 0.55 | 1 |
| 6 | 0.55 | 0 | 0.67 | 1 |
| 7 | 0.33 | 0 | 0.67 | 1 |
| 8 | 0.12 | 0.17 | 0.67 | 1 |
| 9 | 0.33 | 0 | 0.88 | 0.83 |
| 10 | 0.25 | 0.25 | 0.25 | 1 |
| 11 | 0.33 | 0 | 0.88 | 0.83 |
| 12 | 0.17 | 0.17 | 0.83 | 0.83 |
| 13 | 0.4 | 0.5 | 0.8 | 1 |
| 14 | 0.33 | 0 | 0.67 | 1 |
| 15 | 0.33 | 0 | 0.2 | 1 |
| 16 | 0.33 | 0 | 0.8 | 0.7 |
| 17 | 0.2 | 0 | 0.25 | 1 |
| 18 | 0.4 | 0 | 0.8 | 1 |
| 19 | 0.75 | 0 | 0.8 | 1 |
| 20 | 0.2 | 0 | 0.25 | 1 |
| 21 | 0.33 | 0 | 0.83 | 0.83 |
| 22 | 0.17 | 0.17 | 0.67 | 1 |
| 23 | 0.2 | 0 | 0.25 | 1 |
| 24 | 0.33 | 0 | 0.67 | 1 |
| 25 | 0.33 | 0 | 0.67 | 1 |
| 26 | 0.33 | 0 | 0.67 | 1 |
| 27 | 0.55 | 0 | 0.67 | 1 |
| 28 | 0.45 | 0 | 0.67 | 1 |
| 29 | 0.25 | 0 | 0.55 | 1 |
| 30 | 0.33 | 0 | 0.67 | 1 |
| 31 | 0.33 | 0 | 0.2 | 1 |
| 32 | 0.33 | 0 | 0.67 | 1 |
| 33 | 0.33 | 0 | 0.8 | 0.7 |
| 34 | 0.33 | 0 | 0.67 | 1 |
| 35 | 0.75 | 0 | 0.8 | 1 |
| 36 | 0.2 | 0 | 0.25 | 1 |
| 37 | 0.55 | 0 | 0.67 | 1 |
| 38 | 0.45 | 0 | 0.67 | 1 |
| 39 | 0.25 | 0 | 0.55 | 1 |
| 40 | 0.35 | 0 | 0.25 | 1 |
| 41 | 0.75 | 0 | 0.65 | 1 |

The control values are float32 in the binary (`0.33` is `0.33000001311302185`).

### 3.3 What the table implies

- `[BIN]` No curve overshoots: every `y` control is in `[0, 1]`. Every overshoot in an
  effect (Bounce's 1.25 then 0.909, Magic Replace's 1.08) is in the keyframe **values**.
- `[BIN]` There is no spring anywhere in the family.
- Curve 12 `(0.17, 0.17, 0.83, 0.83)` has both control points on the diagonal, so it is
  **exactly linear** (`y = x`, like curve 0). It is Rotate's continuous loop (§7.5), which
  therefore spins at constant speed and joins itself without a kink.

## 4. Motion groups and the stagger

### 4.1 Groups are compacted, ascending

`[BIN]` RenderBox counts the distinct `motionGroup` values of a glyph (`glyph[+0x1d8]`, a
popcount, 0x1A7820268–0x1A7820274) and **compacts** them to `0 … n−1` in ascending order of
id (0x1A7820284–0x1A78202F4), stored as `layer[+0x48]`. Every stagger, every header index
(mode 1, §2.2) and every clock delay (§4.6) is in that numbering.

**The model** `[INF]`: group `i` is the `i`-th smallest distinct `motionGroup` value; its
layers are those carrying it. When the effect is not by layer (option bit 3 clear), there
is **one** group holding every layer (`n = 1`). Ids need not be contiguous (`wifi` draws
its groups in document order 2, 1, 0; the compacted order is 0, 1, 2).

### 4.2 The step: a budget with a ceiling

`[BIN]` Every by-layer effect that staggers computes

```
step = min(B / (n − 1), C)          n < 2 → step = 0
```

| effect | budget `B` (s) | ceiling `C` (s) | addresses |
|---|---|---|---|
| Bounce (once), Wiggle (once) | `0.1499999761581421` | `0.05000000074505806` | 0x1A7960CD4, 0x1A7960CA8 |
| Bounce, Wiggle continuous (clock delay, §4.6) | `0.15000000596046448` | `0.05000000074505806` | 0x1A7960CAC, 0x1A7960CA8 |
| Scale, Replace (both halves), Appear | `0.15000000596046448` | `0.05000000074505806` | 0x1A7960CAC, 0x1A7960CA8 |
| Disappear | `0.10000000149011612` | `0.03333333507180214` | 0x1A7960D0C, 0x1A7960CB4 |
| Breathe | `0.25` (immediate) | `0.1666666716337204` | 0x1A789EC54, 0x1A7960C80 |
| Rotate once, `n > 2` | `0.2666666805744171` | `0.13333334028720856` | 0x1A7960CA4, 0x1A795FD38 |
| Rotate once, `n = 2` | fixed step `0.13333334028720856` | — | 0x1A795FD38 |
| Rotate continuous intro | `0.25` (immediate) | `0.0833333358168602` | 0x1A78A00F4, 0x1A796032C |
| Pulse | no stagger: one header | — | 0x1A789EB74 |
| Draw | a fraction of the previous group's duration (§7.8) | — | 0x1A7960CBC, 0x1A7960CB8 |

The ceiling binds for `n − 1 < B / C`: with the 0.15/0.05 pair, under 4 groups the step is
0.05; from 4 groups on it is `0.15 / (n − 1)`.

### 4.3 The last segment shrinks

`[BIN]` In the once forms of **Bounce, Wiggle, Appear and Disappear**, a group that starts
at `start_i` gives its **last** segment (or its only one) the duration `D − start_i`, with
`D` that segment's unstaggered duration, so **every group ends at the same instant** (e.g.
Appear `0.25 − start_i`, 0x1A78A0D58).

The other staggered effects do **not** all end together; their start and end times are in
§4.4 and §7: Breathe group `i` ends at `3.0 − step · (n − 1 − i)` (only the last ends at
3.0, §7.3); Scale up and Replace out style 2 start every group at 0 and end group `i` at
`0.25 − step · (n − 1 − i)`; Replace in styles 1 and 3 start every group at `s0` and end
group `i` at `s0 + 0.25 − step · (n − 1 − i)`. Scale down and Replace out style 1 do end
together (descending starts, common end 0.25).

### 4.4 Who starts first

`[BIN]` Group `i` starts at `i · step` (ascending) or `(n − 1 − i) · step` (descending, the
last group leads):

| effect | order | addresses |
|---|---|---|
| Bounce Up | ascending | 0x1A789FB20–0x1A789FB78 |
| Bounce Down (bit 31) | descending | idem |
| Wiggle, Breathe, Rotate | ascending | 0x1A789FE64, 0x1A789EC9C, 0x1A78A0268 |
| Scale up (modes 0, 1) | all start at 0; group `i` lasts `0.25 − step·(n−1−i)` | 0x1A78A03D4–0x1A78A0428 |
| Scale down (modes 2, 3) | descending; all end at 0.25 | idem |
| Appear Up, Disappear Down | ascending | 0x1A78A0C9C–0x1A78A0CC0 |
| Disappear Up, Appear Down | descending | idem (`w10 = appear XOR down`) |
| Replace out, style 1 | descending; all end at 0.25 | 0x1A78A1658–0x1A78A16F0 |
| Replace out, style 2 | all start at 0; group `i` ends at `0.25 − step·(n−1−i)` | idem |
| Replace in, styles 1 and 3 | all start at `s0`; group `i` lasts `0.25 − step·(n−1−i)` | 0x1A78A1914–0x1A78A1A98 |
| Replace in, style 2 | group `i` starts at `s0 + step·i`, lasts `0.333 − step·i` | 0x1A78A1A2C–0x1A78A1A98 |
| Draw | chained up or down, §4.5, §7.8 | 0x1A789EA48–0x1A789EA98 |

### 4.5 `drawReversesMotionGroups` belongs to Draw alone

`[BIN]` The document flag ([06](06-drawing.md) §5.2) is bit 3 of `glyph[+0x1e0]`, read from
the symbol defaults key `draw-reverses-motion-groups` (0x1A78202F8–0x1A7820340). A scan of
every byte access to `+0x1e0` finds bit 3 tested in **one** function,
`draw_timing_groups` (0x1A789EA50). No other effect, no clock delay, and no Variable Color
function reads it. Its use is §7.8.

### 4.6 The continuous stagger is a clock delay

`[BIN]` Bounce and Wiggle continuous by layer do **not** stagger their keyframes: each has
one header with no group index (Bounce 0x1A789FBF4–0x1A789FC1C, Wiggle
0x1A789FDC0–0x1A789FDE0). Instead `Animation::description` (0x1A789E5D4) sets flags 6 and 16
(by layer; flags 9 and 10 either way, 0x1A789E6D4–0x1A789E6E8) and `local_time`
(0x1A789E114) shifts each layer's **clock** by `layer_delay(group)` before the intro and
before the loop's modulo:

```
layer_delay(g) = g' · step,   step = 0.05000000074505806 when n < 5,
                               else 0.15000000596046448 / (n − 1)        (0x1A789CCE0)
g' = n − 1 − g for Bounce Down (bit 31, 0x1A789CDA4–0x1A789CDBC), else g
```

`layer_delay` acts only on kinds 3 (Bounce) and 10 (Wiggle) (`cmp w8,#0xa ; ccmp w8,#3`,
0x1A789CCF8) and on Variable Color (kind 1, §9.5). The delay is a constant phase per group:
it survives the loop's seam without cutting a segment, and the outro runs on the shifted
clock too. Rotate continuous does not set flag 6: it staggers only its intro keyframes and
loops in unison (§7.5).

### 4.7 The stagger always fits

Consequence of §4.2–§4.4, for the model's tests: for every effect and every `n ≥ 1`, every
start time is in `[0, B]` and every shrunk segment keeps a positive duration — the
smallest are Bounce `0.2666666507720947 − 0.15 > 0.116`, Wiggle `0.267 − 0.15`, Appear
`0.25 − 0.15`, Disappear `0.1666 − 0.1`, Scale `0.25 − 0.15`, Replace in style 2
`0.333 − 0.15`, Rotate intro `1.8333 − 0.25`. Draw is chained without a budget (§7.8) and
its total is its own sum. `[INF]` (arithmetic on the constants above.)

## 5. Durations

`[BIN]` `Animation::local_duration` (0x1A789C490; jump table 0x1A77EC938), by RenderBox kind
(the `RBSymbolAnimation` enum, from `Animation::keyframes` 0x1A789E39C, table 0x1A77EC9B4):

| kind | effect | keyframes | duration (s) |
|---:|---|---|---|
| 0 | variable value | `variable_value_keyframes` 0x1A789EDDC | `0.3333333432674408` (0x1A7960300) |
| 1 | variable color | `vc_*` 0x1A789EE64 … | by style and layer count (0x1A789C60C), §9.5 |
| 2 | Pulse | `pulse_keyframes` 0x1A789EAF8 | `2.0`; `1.0` with bit 31 (0x1A789C5B8) |
| 3 | Bounce | `bounce_keyframes` 0x1A789FA88 | `0.699999988079071`; continuous period `0.4333333373069763` (table 0x1A7960C08) |
| 4 | Scale | `scale_keyframes` 0x1A78A0320 | `0.25` (0x1A789C554) |
| 5 | Appear | `appear_disappear_keyframes(true)` | `0.25` |
| 6 | Replace | §7.9, §7.10 | by style and subtype |
| 7, 8 | — | none (`keyframes` returns 0) | `[OBS]` what they are |
| 9 | Disappear | `appear_disappear_keyframes(false)` | `0.1666666716337204` (0x1A789C5AC) |
| 10 | Wiggle | `wiggle_keyframes` 0x1A789FD00 | `0.9350000023841858`; continuous period `0.3333333432674408` (table 0x1A7960C00) |
| 11 | Rotate | `rotate_keyframes` 0x1A78A0030 | `2.0` (0x1A789C5A4) |
| 12 | Breathe | `breathe_keyframes` 0x1A789EBE0 | `3.0` (0x1A789C5D0) |
| 13 | Draw On | `draw_on_off_keyframes(true)` | `draw_duration`, base `0.25` (§7.8) |
| 14 | Draw Off | `draw_on_off_keyframes(false)` | `draw_duration`, base `0.1666666716337204` |

`[BIN]` There is no "Color" kind: a colour change is not a RenderBox symbol animation.

## 6. Repeat: once and continuous

### 6.1 Phases

`[BIN]` An effect with a continuous form (Bounce, Wiggle, Rotate: option bit 4, §8.1) is
built per **phase** (`x3` in the keyframe builders): 0 intro, 1 loop, 2 outro. Pulse and
Breathe repeat their once keyframes. The description flags (0x1A789E5D4): bit 9 "has an
intro", bit 10 "has an outro", bit 11 "repeats" (set by the constructor when the repeat
count is > 1, 0x1A789C358–0x1A789C370), bits 6 and 16 the per-layer clock delay (§4.6).

### 6.2 `local_time`

`[BIN]` `Animation::local_time` (0x1A789E114), for a layer at animation time `t`:

1. with flags 6 and 16: `t −= layer_delay(group)` (0x1A789E16C);
2. `t = max(t, 1e-4)` (`9.99999974e-05`, 0x1A789E17C): before its delay a layer holds the
   intro's first value;
3. `t < intro` → phase 0 at `t`;
4. else `t −= intro`; with flag 6 but not 16, `t −= layer_delay` here instead
   (0x1A789E1C0);
5. with flag 11: `s = t / period`; `iter = floor(min(count, s))`; local time
   `(s − iter) · period` (0x1A789E278).

`[OBS]` How the outro is entered when a continuous effect is removed (where `count` comes
from for an indefinite effect, and whether the current loop iteration completes first) is
not read.

### 6.3 The model

`[INF]` An effect builds a **plan**: `tracks` with a `duration`, and for continuous effects
a `loop` (tracks timed from the start of each repetition) with `loopPeriod`, plus
`groupDelay[g]` (§4.6, empty when none) and an optional whole-clock warp (`timeSpan`,
`timeCurve`; Draw `.individually`, §7.8).

- **Once**: evaluate `tracks` at `t`; past `duration` every track holds its last value.
- **Continuous**, effect with a loop: `tracks` is the intro over `[0, duration]` (empty,
  duration 0, when the effect has no distinct intro: Pulse, Breathe); then the loop at
  `(t − duration) mod loopPeriod`. With `groupDelay`, group `g` is evaluated at
  `max(t − groupDelay[g], 0)` through the same rule, and keeps its own layers.
- **Continuous**, effect without a loop (Appear, Disappear, Scale, Replace, Draw): behaves
  as Once.
- `duration()` = the loop period for a looping continuous effect, else the latest track
  end, or the effect's total of §5 when that is longer (Replace's 0.5, Magic Replace's
  badge 1.0), 1.0 when there is neither, so a frame schedule stays sane.
- `loopStart()` = intro duration + the largest `groupDelay` for a looping continuous effect
  (the first instant every group is looping), else 0. Then
  `sample(t) == sample(t + duration())` for every `t ≥ loopStart()`.
- **Stopping a continuous effect.** The outro phases (§7.1, §7.4, §7.5) are documented
  data. `[OBS]` How Apple starts an outro when the effect is removed is not read (§6.2).
  `[INF]` The model, when a continuous effect is stopped, **finishes the current cycle**
  (each group its own, on its delayed clock), then plays the effect's outro from that
  cycle end, then settles at rest (the effect's identity state). A group whose clock had
  not started yet rests at once. Of the outro tables the model plays Bounce's (§7.1): its
  loop ends each cycle at `B`, not at rest, and the outro `B → 1.0` starts from there, so
  stopping never jumps. `[INF]` That the outro starts at the cycle end is the model's
  choice; when Apple starts it is not read. The other loops (Pulse, Breathe, Wiggle,
  Rotate) end each cycle at rest, and the model does not play their outro tables.

### 6.4 Speed

`[INF]` `speed` (finite, > 0) has the public API's meaning: **higher is faster**. The plan
is evaluated at effect time `t · speed`, which divides every duration, stagger and delay by
`speed`. Durations the model returns (`duration()`, `loopStart()`) are the plan's divided
by `speed`.
A non-finite `t` or a non-positive or non-finite `speed` is rejected, never clamped into a
NaN.

### 6.5 Repeat counts

`[BIN]` RenderBox's description of Pulse sets a repeat count of `3.0`
(0x1A789E704–0x1A789E708), replaced only when the client passes
`RBSymbolAnimationRepeatCount` (0x1A790FAA4–0x1A790FABC). `[OBS]` What Symbols passes for a
discrete `.pulse`. `[INF]` The model's Pulse once is one 2.0 s cycle.

## 7. The effects

### 7.1 Bounce

`[BIN]` `bounce_keyframes` (0x1A789FA88). Property `scale` (2), header `2 | (bit3 << 22)`
(0x1A789FB5C) — not a translation.

**Once.** Per group `i`, starting at `start_i` (§4.2 Bounce row; ascending, or descending
with bit 31, 0x1A789FB20–0x1A789FB28), loop 0x1A789FB74–0x1A789FBEC:

```
1.0 →(0.21666666865348816, c3)→ P →(0.21666666865348816, c4)→ R →(0.2666666507720947 − start_i, c5)→ 1.0
```

| value | Up (bit 31 clear) | Down (bit 31) | address |
|---|---|---|---|
| `P` | `1.25` | `0.75` | 0x1A789FB2C–0x1A789FB34 |
| `R` | `0.9089999794960022` | `1.1089999675750732` | table 0x1A7960C68, index `bit31 ? 0 : 4` |

`13/60 + 13/60 + 16/60 = 0.7` is the duration. Up grows to 1.25, rebounds below 1 and
settles; Down shrinks to 0.75, rebounds above 1.

**Continuous** (bit 4). One header, no group index; the by-layer stagger is the clock
delay of §4.6 (`g' = n − 1 − g` for Down).

| phase | keyframes |
|---|---|
| intro | `1.0 →(13/60, c3)→ A →(13/60, c4)→ B` |
| loop (period `0.4333333373069763`) | `B →(13/60, c3)→ A →(13/60, c4)→ B` |
| outro | `B →(0.2666666805744171, c5)→ 1.0` |

`13/60` is `0.21666666865348816`. `[INF]` The model plays the outro when the effect is
stopped, from each group's cycle end (§6.3); when Apple starts it is not read.

| value | Up | Down | address |
|---|---|---|---|
| `A` | `1.0499999523162842` | `0.949999988079071` | table 0x1A7960C58 |
| `B` | `0.949999988079071` | `1.059000015258789` | table 0x1A7960C60 |

**Options.** `[BIN] Symbols 204` `-[NSSymbolBounceEffect _rbOptionsMutable]`
(0x22340A418) passes `_direction` 1 or 2 (else 0); RenderBox (0x1A78FC0FC) sets bit 31 for
`BounceOptions` low part 2 and bit 4 for its `0x10`. `[INF]` direction 2 is `.down`, `0x10`
is the continuous form. `[OBS]` The other build of §1.3 rebounds Up to `1.10899997`.

### 7.2 Pulse

`[BIN]` `pulse_keyframes` (0x1A789EAF8). Property `pulse-alpha` (12); **no stagger**, one
header (0x1A789EB74):

```
1.0 →(d, c1)→ 0.0 →(d, c1)→ 1.0         d = 1.0 (bit 31 clear), 0.5 (bit 31)   (0x1A789EB7C–0x1A789EB88)
```

Duration 2.0 (1.0 with bit 31). `[BIN]` Bit 31 comes only from
`RBSymbolAnimationPulseOptions` low nibble 1 (0x1A78FC208–0x1A78FC23C); no image of the
`26A5416b` cache writes that key, and `NSSymbolPulseEffect` does not (0x22340A1F4): the
half-period Pulse is unreachable from the public API. The model does not offer it.

**Who pulses** (0x1A789EB24–0x1A789EB50): with **no** layer `alwaysPulses` (or not by
layer), header `0x20000C`, every layer. With some layer `alwaysPulses` **and** bit 3 (by
layer), header `0x20082C`: filter `alwaysPulses` (§2.2) — only always-pulses layers that are
not erasers pulse; the rest stay still.

**The floor** (0x1A789D460–0x1A789D4E4): `alpha *= floor + (1 − floor) · v`.

| case | `floor` | address |
|---|---|---|
| default | `0.30000001192092896` | 0x1A795E054 (also `mov`+`movk`+`dup`, 0x1A789D110) |
| some layer always-pulses, bit 3, rendering mode hierarchical | `Model::alpha(m) / Model::alpha(level)`, `m = level − 1` if `level > 1`, else `level + 1` | 0x1A789D46C–0x1A789D4D0 |

The rendering mode is `glyph_info[+0x18]`, mode 3 = `hierarchical` (table 0x1E139ACE8
`{preferred, monochrome, multicolor, hierarchical, palette}`). So a layer at the bottom of
a hierarchical pulse dims to the opacity of its neighbour level; a secondary layer
**brightens** to primary. With the levels of §2.7 the floors are:

| role | floor (light) | floor (dark) |
|---|---|---|
| primary | `0.5 / 1.0 = 0.5` | `0.5` |
| secondary | `1.0 / 0.5 = 2.0` | `2.0` |
| tertiary | `0.5 / 0.18` | `0.5 / 0.25 = 2.0` |

`[INF]` The painted alpha `levelOpacity · alpha` is kept ≤ 1 by clamping `alpha` to
`1 / levelOpacity` (§2.7). The model takes the rendering mode from the caller (it is not in
the drawing).

### 7.3 Breathe

`[BIN]` `breathe_keyframes` (0x1A789EBE0), loop 0x1A789EC9C–0x1A789EDA4. Per group `i`,
ascending, `start_i = i · step`, `step = min(0.25/(n−1), 0.1666666716337204)`:

```
half = (3.0 − step · (n − 1)) · 0.5                                   (0x1A789ECA4–0x1A789ECAC, 0x1A789ED00)
pulse-alpha (12):  1.0 →(half, c1)→ 0.0 →(half, c1)→ 1.0              (0x1A789ED04–0x1A789ED34)
scale (2):         1.0 →(half, c2)→ 1.2000000476837158 →(half, c2)→ 1.0   (0x1A789ED64–0x1A789ED94; 1.2 @0x1A7960CC0)
```

Each group lasts `2 · half = 3.0 − step · (n − 1)`, so group `i` ends at
`3.0 − step · (n − 1 − i)`: only the last group ends at 3.0. The `pulse-alpha` uses
Pulse's floor (§7.2) and Pulse's filter:
by layer with some `alwaysPulses` layer, only those dim (header `0x82C` vs `0xC`,
0x1A789ECB8–0x1A789ECDC); the `scale` header has no filter (0x1A789ED44): every layer
breathes.

**Plain** (bit 31, `BreatheOptions` bit 0, 0x1A78FC080): no `pulse-alpha`. `[INF]` this is
the public `.plain`; the default is `.pulse`.

**Continuous**: the same tracks repeat with period 3.0 (no distinct intro). `[INF]`

### 7.4 Wiggle

`[BIN]` `wiggle_keyframes` (0x1A789FD00). Property (0x1A789FD3C–0x1A789FD5C): `translation`
(5) with bit 31 clear; with bit 31 `symbol-rotation` (6), or `layer-rotation` (7) when bit 3
is also set. Bit 30 negates every value (0x1A789FE24–0x1A789FE38). **No layer filter**,
by layer or not (once header `prop | bit3 << 22`, 0x1A789FE3C): every layer of a group
wiggles.

**Once.** Per group `i`, ascending, step §4.2 (loop 0x1A789FE64–0x1A789FF04):

```
0 →(0.16699999570846558, c6)→ a3 →(0.167, c7)→ a2 →(0.167, c7)→ a1 →(0.167, c7)→ a0 →(0.2670000195503235 − start_i, c7)→ 0
```

| | `a0` | `a1` | `a2` | `a3` | source |
|---|---|---|---|---|---|
| rotation (rad) | `−0.0872664600610733` | `0.10471975803375244` | `−0.13962633907794952` | `0.1745329201221466` | 0x1A7960D20 |
| = degrees | −5 | 6 | −8 | 10 | |
| translation (× point size) | `−0.02500000037252903` | `0.029999999329447746` | `−0.03999999910593033` | `0.05999999865889549` | 0x1A7960D30, × `glyph[+0x20]` at 0x1A789FDB4 |

So the sequence is 10°, −8°, 6°, −5°, 0 (or 0.06, −0.04, 0.03, −0.025, 0 point sizes).
`4 · 0.167 + 0.267 = 0.9350000023841858` is the duration.

**Continuous** (bit 4): one header, the clock delay of §4.6 (never reversed). Amplitude
`A = 0.0872664600610733` rad (0x1A7960CDC/CE0) or `0.02500000037252903` point sizes
(0x1A7960CE4/CE8), sign flipped by bit 30:

| phase | keyframes |
|---|---|
| intro | `0 →(1/12, c7)→ +A →(1/6, c7)→ −A →(1/12, c9)→ 0` |
| loop (period `0.3333333432674408`) | `0 →(1/12, c8)→ +A →(1/6, c7)→ −A →(1/12, c9)→ 0` |
| outro | `0 →(1/12, c8)→ +A →(1/6, c7)→ −A →(1/6, c7)→ 0` |

`1/12 = 0.0833333358168602` (0x1A796032C), `1/6 = 0.1666666716337204` (0x1A7960C80).

**Direction and style.** `[BIN]` The translation direction is the vector `[anim+0x28]`:
`WiggleOptions` low part 1 gives `(1, 0)` (0x1A795E090), low part 2 the vector at
0x1A795DFE8 `[OBS]` (value not read), and `WiggleAngle` (0x1A78FC088) a vector derived from
the angle `[OBS]` (the conversion not read); `WiggleOptions` high part `0x20` sets bit 30.
`[INF]` The model reads the document defaults ([06](06-drawing.md) §5.2):

| `wiggleStyle` | bits | property |
|---|---|---|
| `linear` or absent | — | `translation` along `wiggleAngle` |
| `clockwise` | 31 | rotation (layer rotation by layer, else symbol rotation) |
| `counterClockwise` | 31 and 30 | rotation, negated |

and `dir = (cos θ, sin θ)` in the output space (y down), `θ = wiggleAngle` degrees, 0 when
absent. `[INF]` that 0° is +x and positive angles turn clockwise on screen, as every other
angle here.

### 7.5 Rotate

`[BIN]` `rotate_keyframes` (0x1A78A0030). Property `symbol-rotation` (6, header
`0x400006`), or `layer-rotation` (7) with bit 3 (0x1A78A0060–0x1A78A0098). The end value is
`±2π`, `π = 3.1415927410125732` (0x1A7960B00), negative with bit 31 (0x1A78A00A4–0x1A78A00BC).

**Who turns.** By layer, the headers carry filter `alwaysRotates` (`0x1000` mask `0x80`,
0x1A78A0118–0x1A78A0128, 0x1A78A0250–0x1A78A0260): only `alwaysRotates` layers turn, about
the rotation anchor. If **no** layer has `alwaysRotates`, the effect falls back to a symbol
rotation with **one** group, bit 3 or not (0x1A78A006C–0x1A78A0098), about the metric
centre.

**Direction.** `[BIN]` Without explicit `RotateOptions`, the parser reads the symbol default
`rotatesClockwise`: `true` leaves bit 31 clear (+2π), `false` sets it (−2π)
(0x1A78FC288–0x1A78FC2E4); `RotateOptions` nibble 1 forces +, nibble 2 forces −, `0x10` is
continuous (0x1A78FC240, 0x1A78FC27C). +2π is **clockwise** (y-down space). `[INF]` The
model: `rotatesClockwise` absent or `true` → +2π; `false` → −2π. `[INF]` The model's
`rotateDirection` (the public `.clockwise` / `.counterClockwise` option) overrides that sign
when not `default`; how Symbols maps it onto the options is not read.

**Once** (`n` = groups when by layer with always-rotates layers, else 1):

| groups | per group `i` | addresses |
|---|---|---|
| 1 | `0 →(2.0, c10)→ ±2π` | 0x1A78A00D0 |
| 2 | start `i · 0.13333334028720856`; `0 →(1.8666666746139526, c10)→ ±2π` | 0x1A78A0214–0x1A78A021C |
| > 2 | start `i · min(0.2666666805744171/(n−1), 0.13333334028720856)`; `0 →(1.7333333492279053, c10)→ ±2π` | 0x1A78A0224–0x1A78A0248 |

Every group ends by 2.0.

**Continuous**:

| phase | keyframes |
|---|---|
| intro, 1 group | `0 →(2.5, c11)→ ±2π` |
| intro, `n ≥ 2` | group `i` from `s_i = i · min(0.25/(n−1), 0.0833333358168602)`: `0 →(0.6666666865348816, c11)→ ±2·0.5297074317932129 →(1.8333332538604736 − s_i, c12)→ ±2π` (0x1A78A00DC–0x1A78A01A8) |
| loop (period 2.0) | `0 →(2.0, c12)→ ±2π`, one header, all groups in unison (0x1A78A01AC–0x1A78A01DC) |
| outro | `0 →(2.5, c13)→ ±2π` |

Every group's intro ends at 2.5. The rotation is taken modulo a full turn, so each loop
starts again from 0 without a visible jump.

### 7.6 Scale

`[BIN]` `scale_keyframes` (0x1A78A0320). It compares the origin and destination scale
levels (`[x1+0x1c]`, `[x1+0x20]`); equal → no animation. Mode: destination greater → 0 if
destination ≤ 0, 1 if > 0; origin greater → 3 if origin ≤ 0, 2 if > 0. Property
`scale-interpolant` (3), `0 →(dur_i, c)→ 1`, curve 40 in mode 0, 41 in mode 3, 1 in modes 1
and 2 (0x1A78A03E8–0x1A78A03FC), step §4.2:

| modes | timing |
|---|---|
| 0, 1 | every group starts at 0; `dur_i = 0.25 − step · (n − 1 − i)` |
| 2, 3 | `start_i = (n − 1 − i) · step`; every group ends at 0.25 |

The factor is `k` of §2.4: **up 1.25, down 0.5**, held while the effect is active. Total
`0.25`. `NSSymbolScaleEffect` writes no option (0x22340A964). `[INF]` the direction arrives
as the scale level; `.up` is level 0 → +1 (mode 1: `1 → 1.25`, curve 1, all start
together) and `.down` is 0 → −1 (mode 3: `1 → 0.5`, curve 41, last group first); returning
to level 0 is mode 2 (from up, curve 1) or 0 (from down, curve 40), with `s` the origin's
factor `[INF]`.

### 7.7 Appear and Disappear

`[BIN]` `make_appear_disappear_keyframes` (0x1A78A0BF0), first argument 1 = Appear, 0 =
Disappear.

| | Appear | Disappear |
|---|---|---|
| total `T` | `0.25` | `0.1666666716337204` (0x1A78A0C3C–0x1A78A0C48) |
| step | `min(0.15000000596046448/(n−1), 0.05000000074505806)` | `min(0.10000000149011612/(n−1), 0.03333333507180214)` |
| `clip-alpha` (13), curve 14 | `0 → 1` | `1 → 0` |
| `scale` (2) | `f →(·, c15)→ 1` | `1 →(·, c16)→ f` |

Per group `i`, starting at `start_i` (order §4.4: Appear Up / Disappear Down ascending,
Disappear Up / Appear Down descending), every list lasts `T − start_i` (0x1A78A0D58).

The factor `f` (0x1A78A0CCC–0x1A78A0CEC): `0.75` with bit 30 only (**up**), `1.25` with
bit 31 only (**down**); with neither the scale list is omitted (0x1A78A0D9C–0x1A78A0DA4).
`[BIN]` The default option word for kinds 5 and 9 is `0x4000000D` (bit 30, 0x1A789E620),
cleared only by `AppearDisappearOptions` nibble 1 (0x1A78FC324), which Symbols never sends
(`-[NSSymbolAppearEffect _rbOptionsMutable]` sends 2 up, 3 down or 0,
0x22340ABDC–0x22340ABF4). **So the default is "up": Appear scales 0.75 → 1, Disappear
1 → 0.75.** The fade-only form is unreachable and the model does not offer it.

### 7.8 Draw On and Draw Off

The geometry (what a stroke range does to a layer's outline) is [08](08-draw-clip.md).
`[BIN]` `draw_on_off_keyframes` (0x1A78A051C), `draw_timing_groups` (0x1A789E91C),
`make_draw_on_off_keyframes_` (0x1A78A0E24), `Glyph::layer_draw_duration` (0x1A7822B44).

**Per-layer duration.** A layer that animates its stroke (layer flag 4,
[08](08-draw-clip.md) §2) lasts

```
x   = clamp(strokeLength · 0.17182131111621857, 0, 1)                    (0x1A795FD30)
dur = x · (2 − x) · 0.8666666746139526 + 0.13333334028720856              (0x1A795FD34, 0x1A795FD38)
```

from 0.1333 s (no length) to 1.0 s, `strokeLength` in multiples of the point size
([08](08-draw-clip.md) §3).

**Timing groups.** `draw_timing_groups` writes one `TimingGroup {f32 start; f32 duration;
u8 ×3}` per motion group (always per real group, ascending, whatever bit 3 says). A group's
duration starts at 0 and takes the **maximum** over its layers (`fcmp ; fcsel …, mi`,
0x1A789E9C0–0x1A789E9F0): a strokable layer's own `dur`, any other layer the **base**:

| | base | address |
|---|---|---|
| Draw On | `0.25` | 0x1A78A05F0–0x1A78A0600 |
| Draw Off | `0.1666666716337204` | idem |

**The chain** (bit 3 only; without it every group starts at 0). Groups start one after the
other, each a **fraction of the previous group's duration** after it:

```
start_first = 0;   start_next = start_prev + f · duration_prev
f = 0.18000000715255737 (On, 0x1A7960CBC), 0.3799999952316284 (Off, 0x1A7960CB8), 1.0 with bit 31
```

**Order** (0x1A789EA48–0x1A789EA98): `w9 = (Off AND bit 30)`, `w10 =
drawReversesMotionGroups`; equal → chained from group 0 upward; different → from the last
group downward. So Draw On and Draw Off run **descending exactly when the document flag is
set**, and Draw Off with bit 30 (`.reversed`) flips that.

**Total** (`draw_duration`, 0x1A789E84C–0x1A789E8A4): the latest `start + duration` over
groups, plus `0.03333333507180214` on a Draw Off group that has a layer clipping its stroke
(`TimingGroup` byte `+0xa`, 0x1A789E870–0x1A789E880).

**The stroke keyframes.** One header **per layer** (`0x400000E/F`, index mode 2), starting at
its group's start, lasting the layer's own `dur` (0x1A78A0F74–0x1A78A0FD0). Curve
(0x1A78A0E78–0x1A78A0E94): **17 On, 18 Off**; 0 (linear) with bits 3 and 31 together.
Property and direction (0x1A78A0EB8–0x1A78A0EF4): `w9 = On | bit30`; `w9 ≠ 0` →
`stroke-end` (15), else `stroke-start` (14); first value `On ? !w9 : w9`, last `!w9`:

| | property | values | range drawn |
|---|---|---|---|
| Draw On | `stroke-end` | `0 → 1` | `[0, e]` |
| Draw Off | `stroke-start` | `0 → 1` | `[e, 1]`: erased from where it began |
| Draw Off, bit 30 (`.reversed`) | `stroke-end` | `1 → 0` | `[0, 1 − e]`: retracts to its start |

**Draw Off's plateau.** On every layer that clips its stroke (`[layer+0x6c]` bit 1, set for
every layer that stores stroke keyframes, 0x1A7822940–0x1A7822948, and by attachments,
0x1A7821668–0x1A782167C), Draw Off becomes (0x1A78A0FF4–0x1A78A1058):

```
0 →(dur, c18)→ 1 − 1e-4 →(1/30, c0)→ 1 − 1e-4 →(0, c0)→ 1           (stroke-start)
1 →(dur, c18)→ 1e-4     →(1/30, c0)→ 1e-4     →(0, c0)→ 0           (stroke-end, reversed)
```

(`−9.9999997e-05` @0x1A795FD3C, `+` @0x1A795E098), and from `start + dur` a
`stroke-attachment-scale` (16) list, header `0x4000010` (0x1A78A1064–0x1A78A10C8):
`1 →(0.03333333507180214, c0)→ 0.5 →(0, c0)→ 0`. Only riders read it
([08](08-draw-clip.md) §11.5).

**Bit 29** (0x1A78A0FE8–0x1A78A1134; set only by Magic Replace, §7.10): an extra `clip-alpha`
per layer: On `0 →(0)→ 1` at the layer's start (hidden until it begins); Off `1 →(0)→ 0` at
its end (plus 1/30 on a clipping layer).

**Layers that cannot animate their stroke** get no stroke keyframes
(`make_draw_on_off_keyframes_` skips them and returns 1, 0x1A78A0F64–0x1A78A0F70). Then
`draw_on_off_keyframes` calls `make_appear_disappear_keyframes(on, options with bits 29–31
replaced by bit 30, the timing groups, filter mask 0x10 value 0)` (0x1A78A0664–0x1A78A068C):
**Draw On is the "up" Appear and Draw Off the "up" Disappear** (§7.7) for those layers, on
Draw's group clock: group `i` starts at its `TimingGroup` start (with bit 3) and lasts
`T − offset_i`, `offset_i` the Appear/Disappear stagger (`i · step` On, `(n−1−i) · step`
Off) (0x1A78A0D40–0x1A78A0D58). `[CAR]` 26,448 documents have no stroke keyframes at all;
for them Draw is exactly this.

**`.individually`** (bits 3 and 31): with **one** group bit 31 is cleared first
(0x1A78A0624–0x1A78A0630) and nothing changes. With more than one, every segment is linear,
the chain fraction is 1.0 (one group after the other, constant speed), and the **whole
clock** is warped once (0x1A78A0690–0x1A78A0728):

```
t' = total · curve(t / total),   curve 17 (On) or 18 (Off),   total = draw_duration
```

**Options** `[BIN] Symbols 204`: `-[NSSymbolDrawOnEffect effectWithIndividually]` stores
layer behaviour 3 (0x22340BB94); `_rbOptionsMutable` (0x22340BC00) maps behaviour 1/2/3
(byLayer / wholeSymbol / individually) through table 0x2234163F8 `{0, 0, 1}` to
`DrawOnOffOptions` bit 0 (→ RenderBox bit 31, 0x1A78FC048–0x1A78FC054) and sets `byLayer`
(bit 3) for 1 and 3. `-[NSSymbolDrawOffEffect effectWithReversed]` sets `DrawOnOffOptions`
bit 1 → bit 30 (0x22340BEEC–0x22340BEF8).

### 7.9 Replace

**Subtype** `[BIN]` (0x1A789E474–0x1A789E4B0): `((opts & 0x7800000) − 0x800000) >> 23`. No
subtype is the plain Replace (`make_replace_keyframes`, 0x1A78A1B9C); subtypes 0–7 are
Magic Replace (§7.10).

**Style** `[BIN]`: the two high option bits (`ReplaceOptions`, 0x1A78FC148), named after the
public `NSSymbolReplaceContentTransition` styles:

| RB style | bits | public | model name |
|---:|---|---|---|
| 0 | — | (only via the raw key, nibble 1) | `plain` |
| 1 | 30 | `.downUp` (**the default**) | `downUp` |
| 2 | 31 | `.upUp` | `upUp` |
| 3 | 30, 31 | `.offUp` | `offUp` |

`[BIN] Symbols 204` sends `ReplaceOptions = 0xE1 + style` for styles 1–3, and `0` or `0xE0`
for the default by an SDK version test (0x22340C3B4–0x22340C3E0; `[INF]` that the test is the
SDK's); RenderBox's default word `0x7800002D` carries bit 30 (0x1A789E654). So the public
default is downUp; style 0 is reachable only through RenderBox's raw key.

**Duration** (0x1A789C578): `0.5`; `0.25` in style 3.

**Two halves on one clock.** The source plays the **out** half
(`make_replace_from_keyframes`, 0x1A78A14E0), the destination the **in** half
(`make_replace_to_keyframes`, 0x1A78A17D4), both from `t = 0`; the in half starts at `s0`
(0x1A78A1BF4–0x1A78A1C28). `step` is §4.2's Replace row; order §4.4.

| style | out (source) | in (destination), `s0` |
|---|---|---|
| 0 plain | `clip-alpha` all layers: `1 →(0.25, c1)→ 0.20000000298023224 →(0, c0)→ 0` (0x1A78A15B0–0x1A78A15E4); no scale | `s0 = 0.25`: `clip-alpha` `0 →(0, c0)→ 0.2 →(0.25, c1)→ 1` (0x1A78A1850–0x1A78A18BC) |
| 1 downUp | `scale` group `i` from `start_i = (n−1−i)·step`: `1 →(0.25 − start_i, c19)→ 0.5`; `clip-alpha` `1 →(0)→ 0` at 0.25 (table 0x1A7960D40) | `s0 = 0.25`: `clip-alpha` `0 →(0)→ 1` at `s0` (table 0x1A7960D58); `scale` every group from `s0`: `0.5 →(0.25 − step·(n−1−i), c20)→ 1` |
| 2 upUp | every group from 0: `scale` `1 →(0.25 − step·(n−1−i), c21)→ 1.25` and `alpha` (1, header `0x806001`) `1 →(same, c21)→ 0` | `s0 = 0.1666666567325592` (0x1A7960D14): group `i` from `s0 + step·i`: `scale` `0.4000000059604645 →(0.3330000042915344 − step·i, c22)→ 1`, `clip-alpha` (header `0x100600D`) `0 →(same, c22)→ 1` |
| 3 offUp | `clip-alpha` final value 0: gone at once | `s0 = 0`: `scale` `0.5 →(0.25 − step·(n−1−i), c23)→ 1`, `clip-alpha` `0 →(same, c24)→ 1` |

`[INF]` The model samples each drawing of the pair with its half named; the two drawings'
layers never need to correspond.

### 7.10 Magic Replace

`[BIN]` `Animation::apply`, for kind 6, calls `Animation::infer_replace_subtype(source,
destination)` (0x1A789CFC0–0x1A789CFC8; body 0x1A789DB80) before building the keyframes. It
clears bits 23–26, then:

1. **Preconditions** (0x1A789DBE0–0x1A789DC00): the same point size and the same continuous
   size (`glyph[+0x20]`, `[+0x24]`); for slash and badge also the same rendering mode and
   continuous weight. Otherwise no subtype: the **plain Replace** of §7.9.
2. **Slash** (bit 29 and some glyph has a `_slash` layer; 0x1A789DC3C–0x1A789DD04): if the
   two glyphs' tags **outside** their slash layers are equal (`tags_subtract`, lambda
   `$_1`): source has a slash and destination not → subtype 1 **slash remove**
   (`0x1000000`); the reverse → subtype 0 **slash add** (`0x800000`).
3. **Badge** (bit 28; 0x1A789DD3C–0x1A789DE18, 0x1A789E018): with the non-badge tags equal:
   source badge only → 3 **badge remove** (`0x2000000`); destination only → 2 **badge add**
   (`0x1800000`); both with different badge tags → 4 **badge move** (`0x2800000`).
4. **Draw** (bit 27, and some layer of either glyph has flag `0x8` or `0x10`;
   0x1A789DE4C–0x1A789DFD8): when both glyphs have enclosure layers, intersect the **raw**
   tag sets of every pair of enclosure layers: more than one common tag → 7
   (`0x4000000`); exactly one, not an enclosure tag → 6 (`0x3800000`); else, if some layer
   of either glyph animates its stroke → 5 (`0x3000000`).
5. Nothing matched → plain Replace.

`[INF]` In step 4 the model takes the most any one pair of enclosure layers shares: 7 if
some pair shares more than one tag, else 6 if some pair shares exactly one that is not an
enclosure tag.

Bits 27–29 are on by default (`0x7800002D`); `ReplaceOptions` bits 5, 6, 7 clear 29, 28, 27
(0x1A78FC3A0–0x1A78FC3E8). `[INF]` The public `.magic(fallback:)` is "bits 27–29 on", the
fallback being the style.

`[CAR]` Examples: `arrow.up.circle → arrow.down.circle`: `{_enclosure.stroke, circle}` in
common → 7. `checkmark.circle → checkmark.circle.fill`: `{circle}` → 6. `plus → minus`: no
enclosure, strokable → 5.

**Comparing tags** `[INF]`. RenderBox compares interned glyph tag sets; the catalog's
`-sfsymbols-layer-tags` also carry the symbol's own **name** (`wifi`'s layers are `{wifi}`,
`wifi.slash`'s `{wifi, wifi.slash}` and `{_slash, wifi.slash}` `[CAR]`), which never agree
across a pair. So before comparing in steps 2–3 the model drops a tag equal to either
glyph's symbol name or extending its **own** glyph's name with a dotted suffix
(`speaker.slash.rtl`); a tag that only extends the other glyph's name stays. The
preconditions of step 1 hold by construction when both drawings come from one weight, size
and rendering mode; the model has no render-size precondition and checks none of them. Step 4 uses raw tags.

**Slash and badge tables** `[BIN]` (static `Keyframes`, 0x18 bytes each; values from the
tables at the addresses shown). Filters as §2.2 with the side bits:

| subtype | table | property | layers | keyframes |
|---|---|---|---|---|
| 0 slash add | 0x1E139AEC8 | `stroke-end` | `_slash` (both glyphs) | `0 →(1/3, c25)→ 1.08 →(1/3, c26)→ 1` (0x1A7960D70) |
| 1 slash remove | 0x1E139AEF8 | `stroke-end` | `_slash` | `1 →(0.25, c30)→ 0` (0x1A7960D94) |
| | | `scale` | all | `1 →(0.22, c27)→ 1.05 →(0.22, c28)→ 0.97 →(0.26, c29)→ 1` (0x1A7960DAC) |
| 2 badge add | 0x1E139AF40 | `scale` | all, start `0.05` | `1 →(0.217, c37)→ 1.05 →(0.217, c38)→ 0.959 →(0.266, c39)→ 1` (0x1A7960DDC) |
| | | `scale-badge` | `_badge` | `0.75 →(0.25, c31)→ 1` (0x1A7960E3C) |
| | | `clip-alpha` | `_badge` | `0 →(0.25, c32)→ 1` (0x1A7960E54) |
| 3 badge remove | 0x1E139AFA0 | `scale` | all | `1 →(0.217, c37)→ 0.95 →(0.217, c38)→ 1.059 →(0.266, c39)→ 1` (0x1A7960E0C) |
| | | `scale-badge` | `_badge` | `1 →(0.167, c33)→ 0.75` (0x1A7960E6C) |
| | | `clip-alpha` | `_badge` | `1 →(0.167, c34)→ 0` (0x1A7960E84) |
| 4 badge move | 0x1E139B000 | `scale` | all, start `0.05` | as badge remove |
| | | `scale-badge` | source `_badge` (`0x104`) | `1 →(0.25, c35)→ 0.5` (0x1A7960E9C) |
| | | `scale-badge` | destination `_badge` (`0x204`), start 0.25 | `0.5 →(0.25, c36)→ 1` (0x1A7960EB4) |
| | | `clip-alpha` | source `_badge`, start 0.25 | `1 →(0)→ 0` |
| | | `clip-alpha` | destination `_badge`, start 0.25 | `0 →(0)→ 1` |

The durations are float32: `1/3` = `0.3333333432674408`, `0.22` = `0.2199999988079071`,
`0.26` = `0.25999999046325684`, `0.217` = `0.21699999272823334`, `0.266` =
`0.26600000262260437`, `0.167` = `0.16699999570846558`, `0.05` = `0.05000000074505806`.
Durations (0x1A789C578): slash add `0.6666666865348816`, slash remove `0.699999988079071`,
badge 1.0. A `stroke-end` on a `_slash` layer that animates its stroke is its clip end
(the 1.08 overshoot extends the tip, [08](08-draw-clip.md) §7.3); on any other it is
`alpha *= v` `[BIN]` (§2.3), clamped to 1 `[INF]`.

`[INF]` A source layer that its subtype's tables do not reach (a non-slash layer in a slash
subtype, a non-badge one in a badge subtype) is hidden: the subtype requires both glyphs
to agree on that content, so the destination draws it once.

**Draw subtypes 5–7** `[BIN]` (`replace_draw_keyframes`, 0x1A78A07C0). The options passed
are `0x20000000` (bit 29 only; no bit 3, so groups are **not** chained: every layer starts
together with its own duration, and bit 29 hides a layer before its On and after its Off).
In subtypes 6 and 7 the enclosure layers (flag `0x8`) take no part in the draw or replace
(filter mask 8, value 0); in 5 the mask is 0.

- **Source** (0x1A78A0944–0x1A78A0A70). Style 3: only `clip-alpha 1 →(0.083, c1)→ 0`
  (header `0x80600D`, `0x80610D` in 6/7). Other styles: if the source has a strokable
  layer, Draw Off from `t = 0`; whatever cannot stroke (filter `notStroke`) plays the out
  half of §7.9; with no strokable layer, every admitted layer plays the out half.
- **Destination** (0x1A78A0A74–0x1A78A0B64): the same with Draw On from `s8`, and the in
  half of §7.9 starting at `s8` (at `s8 − 1/12` in style 2).
- `s8 = draw_duration(source, Off, options 0, base 0.25, mask)` (0x1A78A08C8–0x1A78A0940);
  0 in style 3. In subtypes 6/7, a source made only of enclosure layers gives `s8 = 0.083`
  (6) or 0 (7). `[INF]` The model clamps style 2's `s8 − 1/12` at 0: a negative start is
  not representable on a track.
- **Subtype 6, the enclosure cross-fades**: source enclosure `1 →(0.083, c1)→ 0` from
  `max(s8, 0.083)` (header `0x84210D`); destination enclosure `0 →(0)→ 0 →(0.083, c1)→ 1`
  from `max(s8 − 0.083, 0)` (`0x104410D`). `[OBS]` For a source made only of enclosure
  layers and in style 3, whether the source's fade starts at 0 or at 0.083 is not settled;
  the model uses `max(s8, 0.083)`.
- **Subtype 7**: the enclosure gets no keyframes on either side. `[INF]` The model hides the
  source's copy and the destination draws it once. `[OBS]` whether Apple draws it twice.
- **Duration** (0x1A789C690–0x1A789C7B4): `max(off, f) + max(on, f)`, `f = 0.083` in subtype
  6, else 0; in style 3 the off half counts 0 and the floor is 0.083.
  `0.083` = `0.08299999684` (0x1A7960C88). So style 3 lasts `max(on, 0.083)`. `[INF]`
  `off` is `s8` and `on` is `draw_duration(destination, On, options 0, base 0.25, mask)`.
- **Layers that cannot stroke** `[BIN]` (0x1A78A0944–0x1A78A0B64): the replace path runs the
  draw on/off keyframe builder for the strokable layers only, so they get no Appear or
  Disappear (§7.8): they play the §7.9 half and nothing else. An eraser layer that cannot
  stroke is outside `notStroke` and gets no keyframes at all.

## 8. Option bits

### 8.1 The option word

`[BIN]` The 32-bit word at `[anim+0xc]`, from the dictionary parser
(0x1A78FBE64–0x1A78FC57C) and its uses. Bits mean different things per effect:

| bit | effect | meaning | source |
|---:|---|---|---|
| 3 | all | **by layer**: count motion groups (else one group) | `RBSymbolAnimationByLayer` → 8 (0x1A78FBF5C–0x1A78FBF7C) |
| 4 | Bounce, Wiggle, Rotate | **continuous**: the phased form | `BounceOptions`/`RotateOptions` `0x10` (0x1A78FC138, 0x1A78FC27C) |
| 23–26 | Replace | subtype field (§7.9) | `infer_replace_subtype` |
| 27 | Replace | Magic Replace by draw allowed | default on |
| 28 | Replace | Magic Replace by badge allowed | default on |
| 29 | Replace | Magic Replace by slash allowed | default on |
| 29 | Draw | `clip-alpha` outside the layer's own span | set by Magic Replace |
| 29 | Variable Color | `variable-alpha-fade` target 0 instead of 0.3 | 0x1A789D544 |
| 30 | Appear, Disappear | **up**: scale 0.75 | default on |
| 30 | Wiggle | negate every value | `WiggleOptions` high `0x20` |
| 30 | Draw Off | **reversed**: retract, and flip the group order | `DrawOnOffOptions` bit 1 |
| 30–31 | Replace | style 0–3 | `ReplaceOptions` |
| 31 | Bounce | **down**, and descending order | `BounceOptions` low 2 |
| 31 | Pulse | half period (unreachable) | `pulseOptions` low 1 |
| 31 | Breathe | **plain**: no pulse-alpha | `BreatheOptions` bit 0 |
| 31 | Wiggle | rotation instead of translation | `[INF]` from the style |
| 31 | Rotate | negative (counter-clockwise) | `RotateOptions` low 2, or `rotatesClockwise = false` |
| 31 | Appear, Disappear | **down**: scale 1.25 | |
| 31 | Draw | **individually** (with bit 3) | `DrawOnOffOptions` bit 0 |

`[INF]` The parser keeps a second word (`[sp+0x10]`), read as "explicitly set".

### 8.2 Default words

`[BIN]` From `Animation::description` (0x1A789E5D4): Appear/Disappear `0x4000000D`
(0x1A789E620), Replace `0x7800002D` (0x1A789E654). `[OBS]` The meaning of bits 0, 2 and 5 in
those words. Note bit 3 (by layer) is on in both.

### 8.3 The model's `Spec`

`[INF]` The fields a caller sets, and the bits they stand for:

| field | values | bits |
|---|---|---|
| `kind` | appear, disappear, bounce, breathe, draw, pulse, rotate, scale, replace, magicReplace, wiggle, variableColor | RenderBox kind (§5) |
| `repeat` | once, continuous | 4 |
| `speed` | > 0 | — (§6.4) |
| `byLayer` | boolean, default true | 3 |
| `direction` | default, up, down | Bounce 31; Appear/Disappear up 30, down 31 (default = up); Scale level ±1 (default = up) |
| `reversed` | boolean | Draw: Off instead of On; Scale: down when `direction` is default |
| `breathePlain` | boolean | 31 |
| `replaceStyle` | plain, downUp (default), upUp, offUp | 30–31 |
| `replaceHalf` | out, in | which drawing of the pair |
| `drawIndividually` | boolean | 31 (with 3) |
| `drawReversedOrder` | boolean | 30 (Draw Off only) |
| `rotateDirection` | default, clockwise, counterClockwise | Rotate 31 `[INF]` (§7.5) |
| `renderingMode` | monochrome, hierarchical, palette, multicolor | glyph mode (Pulse floor) |
| `variableValue` | `[0, 1]` | §9 |

## 9. Variable Color

### 9.1 The data

`[CAR]` ([06](06-drawing.md) §5): `variableValueMode` is `color` (33,696 documents) or
`draw` (3,279); `variableThreshold` on 7,188 layers (values `0.0`, then a ladder 0.26, 0.39,
0.51, 0.64, 0.76, 0.89 and others); `variableDraw` a pair on 3,639 layers; `vcContinuous`
on 153 documents (51 identifiers). `[CAR]` No `draw` document carries a
`variableThreshold`.

### 9.2 Static colour mode

The value `v ∈ [0, 1]` is a position, not a time. `[INF]` A non-finite `v` reads 0; `v` is
clamped to `[0, 1]`. For each layer with a threshold `θ` (layers without one are always
drawn at full alpha):

An **inactive** layer is dimmed, not removed: its alpha is `a₀ = 0.30000001192092896`, the
target of `variable-alpha-fade` (§2.3 property 10, constant 0x1A795E054, §9.5), or `a₀ = 0`
with option bit 29 (0x1A789D544, §8.1). `[INF]` that the static form rests where the fade
property drives an inactive layer; the model's `Spec` has no field for bit 29 (the public
`hideInactiveLayers`, §9.5), so its static form uses `0.3`.

- **Hard cut** (`vcContinuous` false): `alpha = v ≥ θ ? 1 : a₀`. `[INF]` `≥`, compared
  directly, no quantisation.
- **Band** (`vcContinuous` true): `alpha = a₀ + (1 − a₀) · clamp((v − (θ − w)) / (2w), 0, 1)`
  with `w = 0.06`. `[INF]` The band width is the model's: thresholds step by about 0.13, and
  0.06 keeps adjacent bands apart. `[OBS]` Apple's continuous rendering was not located in
  RenderBox.

`visible = alpha > 0` (always, unless `a₀ = 0`).

### 9.3 Static draw mode

`[CAR]` `variableDraw` reads as `(offset, length)`, not `(start, end)`: of 3,648 pairs none
has `offset + length > 1`; every pair with second value 1 has first value 0; 66 of the 69
multi-pair documents tile `[0, 1]` exactly in ascending offset (`touchid`: `(0, 0.17)
(0.17, 0.17) (0.33, 0.17) … (0.83, 0.17)`); 180 pairs have first > second.

`[INF]` The layer's band is `[offset, offset + length]` of the value range, and the fraction
of the layer's own stroke drawn is `clamp((v − offset) / length, 0, 1)` (a hard cut at
`offset` when `length ≤ 0`). A layer without a pair takes the band of its motion group:
group `i` of `n` (ascending, §4.1; `drawReversesMotionGroups` is not read, §4.5) gets
`(i/n, 1/n)`. The fraction drives the layer's Draw range `[0, fraction]`
([08](08-draw-clip.md)); on a layer that cannot animate its stroke it is `alpha *=
fraction` (the `stroke-end` fallback of §2.3). `[OBS]` How RenderBox renders variable draw
was not read.

### 9.4 A change of value

`[BIN]` Kind 0, `variable_value_keyframes` (0x1A789EDDC), lasts `0.3333333432674408`
(0x1A7960300); its alpha table `variable_value::alpha_values` (0x1A7960EFC) is
`0 →(0.3333333432674408, c0)→ 1`. `[INF]` A change of `variableValue` cross-fades linearly
over 1/3 s from the old static state to the new. `[OBS]` Which property the table drives
(`variable-alpha`, 8, by its name) and between which states.

### 9.5 The animated forms: what is read

`[BIN]` Kind 1, **variable color**. The keyframe builders are `vc_intro_outro`,
`vc_cumulative`, `vc_sequential`, `vc_cumulative_bounce` and `vc_sequential_bounce`, in
0x1A789EE64 … 0x1A789F600. Their duration depends on the style and the number of layers
(`local_duration`, 0x1A789C60C). Constants materialised in that family:

| value | address |
|---|---|
| `0.30000001192092896` | 0x1A795E054 (the inactive alpha) |
| `0.6666666865348816`, `0.6666666269302368` | 0x1A7960CC4 |
| `0.3333333432674408`, `0.01666666753590107`, `0.0833333358168602`, `0.111111119389534` | — |
| `1.3333333730697632`, `0.2083333432674408`, `0.4166666865348816` | — |

`[BIN]` Inactive layers are driven by `variable-alpha-fade` (10) toward `0.3`, or toward 0
with option bit 29 (0x1A789D540–0x1A789D544). `layer_delay` (§4.6) also acts on kind 1, so
the animated forms stagger by motion group through the clock. No `vc_*` function reads
`drawReversesMotionGroups` (§4.5).

`[INF]` Name correspondence with the public options: `.iterative` ↔ `vc_sequential`,
`.cumulative` ↔ `vc_cumulative`, `.reversing` ↔ the `_bounce` variants, the
`dimInactiveLayers` / `hideInactiveLayers` pair ↔ bit 29 clear / set, and `vc_intro_outro`
the start and stop transitions. None of these is read.

### 9.6 The animated forms: what is open

`[OBS]` **The timing of Variable Color's animated forms is not read.** To specify them, read
in RenderBox 8.0.84 / `26A5416b`:

1. the `push_keyframes` / `push_value` sequences of the five `vc_*` functions
   (0x1A789EE64 … 0x1A789F600): property, header filter and index mode, values, durations,
   curves, per layer or per group;
2. kind 1's branch of `local_duration` (0x1A789C60C): the duration as a function of style
   and layer count;
3. kind 1's branch of `layer_delay` (0x1A789CCE0): its step (the Bounce/Wiggle formula of
   §4.6 is read only for kinds 3 and 10) and which index it uses (motion group, or the
   layer's threshold order);
4. the handlers of `variable-alpha-max` (9, 0x1A789D6B0) and `variable-alpha-interpolant`
   (11, 0x1A789D66C), and what `variable-alpha` (8) sets;
5. in Symbols 204, `-[NSSymbolVariableColorEffect _rbOptionsMutable]`: how `.iterative`,
   `.cumulative`, `.reversing`, `dimInactiveLayers`, `hideInactiveLayers` map onto option
   bits, and which bit selects each `vc_*` builder in `Animation::keyframes` (0x1A789E39C);
6. how the threshold ladder (§9.1) orders layers in those forms.

Until then the model offers only the static forms (§9.2–§9.4).

## 10. Not effects

- **Color**: no RenderBox kind (§5). A colour change is a paint change, outside this
  document. `[INF]`
- **Kinds 7 and 8**: build no keyframes. `[OBS]`
- **`scale-badge` outside Magic Replace**, **index mode 3**: not used by any effect above.

## 11. Open questions

- `[OBS]` Variable Color's animated forms (§9.6).
- `[OBS]` How a continuous effect enters its outro when stopped (§6.2); Pulse's repeat count
  as passed by Symbols (§6.5).
- `[OBS]` Wiggle's direction vectors for `WiggleOptions` low part 2 and `WiggleAngle` (§7.4).
- `[OBS]` The other RenderBox 8.0.84 build's Bounce rebound (§1.3).
- `[OBS]` Magic Replace subtype 7's enclosure: drawn by both glyphs? (§7.10)
- `[OBS]` Bits 0, 2, 5 of the default words (§8.2); index mode 3 (§2.2); kinds 7, 8.
- `[OBS]` The continuous Variable Color band (§9.2) and variable draw (§9.3) in RenderBox.
