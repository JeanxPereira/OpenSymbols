# 08 — The Draw clip

How Apple draws a symbol "on" or "off": a filled outline is **cut** along a progress field
built from its stroke keyframes, and every cut is closed by a cap. There is no stroke and
no stroke width: the outline itself is the stroke. This document is the geometry; the
timing that drives the range (`strokeStart`, `strokeEnd`) is [07](07-effects.md) §7.8, and
the data is [06](06-drawing.md) §6.

**Seals.** As in [07](07-effects.md). Two images carry the same clip code under the same
class names (`RB::Path::ClipStroke::{Transform, Clipper, JoinStroke, LengthEstimator,
AttachmentResolver}`, same assertion strings): `[BIN] RB @addr` is **RenderBox 8.0.84 /
`26A5416b`**, the renderer, which is authoritative; `[BIN] CGL @addr` is **CoreGlyphsLib**,
the SF Symbols app 8 (beta) copy, arm64 slice, base 0, whose symbols are not stripped and
where several bodies were read first. Where both are cited the bodies agree. `[CAR]` counts
are over the 36,975 documents of the catalogs.

Nothing here was compared frame by frame against Apple's output. `[OBS]`

## 1. Inputs

For one layer at one instant:

- its `path` (closed subpaths, path coordinates);
- its `strokeKeyframes` `{flags, progress, d0, d1}[]` ([06](06-drawing.md) §6.1): `d =
  subpath + fraction`, the fraction a position along that subpath as a fraction of its arc
  length from its moveto in the path's direction, the closing segment included;
- the range `[lo, hi] = [strokeStart, strokeEnd]` ([07](07-effects.md) §7.8): Draw On
  `[0, e]`, Draw Off `[e, 1]`, Draw Off reversed `[0, 1 − e]`.

`[BIN] RB @0x1A7824E90` `Layer::append_path` passes the layer's range as `(lo, hi)`, clip
flags 0 and line cap 0 = round (`mov w2,#0 ; mov w3,#0`, 0x1A7824EE0–0x1A7824EE8).

`[CAR]` 10,527 documents, 14,523 nodes, 69,543 records, all version 0; `floor(d)` is below
the node's own subpath count on every position; every fraction is in `[0, 1]`; 14,504 of
14,523 nodes carry both a progress-0 and a progress-1 record.

## 2. Which layers animate their stroke

`[BIN] RB` A layer animates its stroke (layer flag 4, `[layer+0x68]` bit 4) when it stores
clip-stroke keyframes (`Glyph::Layer::set_stroke_keyframes`, 0x1A7822768; the gate
`(flags & 0x30000000) == 0x10000000`, 0x1A78227A0) or declares attachments
(`resolve_draw_attachments`, 0x1A7821680). RenderBox's layer is the **family layer**
([06](06-drawing.md) §4.2).

**The model** `[INF]`: a model layer is **strokable** when some layer of its family (same
`familyLayer ≥ 0`) has non-empty `strokeKeyframes` or non-empty `attachments`. A layer with
`familyLayer = −1` is its own family. A strokable layer whose own `strokeKeyframes` are
empty has only un-keyframed subpaths: drawn whole while the family's range is non-empty,
dropped when it is empty (§6.1). `[CAR]` 14,520 stroking families; 18 mix keyframed and
un-keyframed nodes (18 nodes, 15 drawings); 3 declare attachments with no keyframed node.

A non-strokable layer receives no stroke range in a Draw ([07](07-effects.md) §7.8, it
appears or disappears instead); a `stroke-start` / `stroke-end` value that reaches it in
another effect multiplies its alpha by `1 − v` / `v` ([07](07-effects.md) §2.3).

`[OBS]` A RenderBox layer with a `referenceShape` and a positive stroke width also gets
flag 4 and is truly stroked (`append_path`, elements `0x13`, `0x12`); no such layer is known
in the catalog.

## 3. Stroke length

`[BIN] RB @0x1A7822BD0` `stroke_length(layer)` = `Shape::stroke_length(scale) · scale`
(`scale = layer[+0x3c] = glyph[+0x30] = fontMatchingScaleFactor · pointSize /
referencePointSize`, 0x1A781F9F0–0x1A781FA2C), 0 unless the layer animates its stroke.
`Shape::stroke_length` (0x1A7822C24) runs `ClipStroke::LengthEstimator` over the layer's
keyframes with tolerance `0.5 / scale` (cached in `[shape+0x50]`), else
`RBPathGetLength(path, 0.5)`.

`[BIN] CGL @0xB9C8` `LengthEstimator::subpath_keyframes`: per (joined, §4) subpath, the
**speed** `v` of §5.3; the estimate is the **maximum** over subpaths
(`CGPathMeasureClippedStrokePath` @0x1788 returns it). `v` is the arc length the drawing
tip covers per unit of progress, i.e. the length of the stroke's centreline. `[INF]` that
RenderBox's estimator returns the same field.

**The model** `[INF]`: `L_path` = the maximum over the family's layers and their subpaths
of `v`, in path units (0 without keyframes). The Draw duration's ratio
([07](07-effects.md) §7.8) is `x = 0.17182131111621857 · L_path · fontMatchingScaleFactor
/ referencePointSize` `[BIN] RB @0x1A7822B44` (dimensionless, independent of the point
size). `fontMatchingScaleFactor` is not in the catalog `[OBS]`; the model converts path
units to point sizes through the transform's uniform scale `s` (`sqrt|ad − bc|`) over
`referencePointSize`: `strokeLength = L_path · s / referencePointSize`, which is
`L_path / 2048` on every rendition checked ([06](06-drawing.md) §9.1). Without metrics the
viewBox height stands in for `referencePointSize`.

## 4. Compound records: two subpaths joined into one

`[BIN] CGL @0x7740/@0x799C`, `RB @0x1A7811F08` `JoinStroke`. A record is **compound** when
`floor(d0) ≠ floor(d1)`. `[CAR]` All 38,205 compound records name **adjacent** subpaths.
For each pair `(i, i+1)` named by a compound record, when subpath `i+1` closes, the two are
replaced by **one** contour:

1. the **seam** is the compound record with the lowest progress (in the catalog the
   progress-0 one; 5,529 of them carry flag 4 `invertJoined`), fractions `fA` on `i`,
   `fB` on `i+1`, lengths `LA`, `LB`;
2. emit `i[fA·LA … LA] + i[0 … fA·LA]` (subpath `i` rotated to start at the seam), then
   `(i+1)[fB·LB … LB] + (i+1)[0 … fB·LB]`, then close (`Subpath::append_range` ×4,
   `Subpath::close`);
3. the jumps between the loops are caps of the join's line cap (`Subpath::add_capto`
   @0x5154: cap 0 `lineto`, 2 square, else a cubic with handles `1.325 · r`); RenderBox
   joins with cap 0 = round (`set_stroke_keyframes`, `JoinStroke(…, 0, keyframes,
   0.5/scale)`, `[BIN] RB @0x1A7822768`), **once, at load**, replacing the layer's path and
   keyframes;
4. every record is re-mapped into the joined contour's arc length
   (`DistanceMap::operator()` @0x4C04). A point exactly at a seam is both the start and the
   end of its loop; which it takes depends on whether its progress equals the seam's,
   flipped by `invertJoined` (`uVar15 == (progress == seamProgress)` in `closepath`).

`[INF]` The joined ring is a single outline slit at the seam; the slit has no width, so the
jump is a straight line whatever the cap. `[INF]` The seam-point rule's orientation was not
read bit-exactly; the model places a seam point at the end of its loop whose neighbouring
keyframe progress it is closer to (so the field stays continuous), and on a tie the seam
progress goes to the start of the first loop and the end of the second. `[INF]` A chain
`(i, i+1), (i+1, i+2)`: only the first pair is joined. `[INF]` A compound record on
non-adjacent subpaths is dropped (JoinStroke rejects it; none in the catalog). `[INF]` The
order of a joined contour's records (which corner splitting, §9, depends on) is: the simple
records of subpath `i`, then of `i+1`, then the compound ones.

## 5. The progress field

### 5.1 Single keyframes

`[BIN] CGL @0xAD28` `make_single_keyframes` turns each record of a subpath into **two**
single keyframes `{f64 s = frac(d) · length; f32 progress; u32 index; u32 flags}`, one per
point, and sorts them by `s`. `length` is the subpath's arc length: lines exact
(`Subpath::add_lineto` @0x54A0), cubics by `CG::Cubic::length(0.5)` (`add_cubeto` @0x55DC),
the closing `lineto` appended before measuring (`KeyframeConsumer::closepath` @0x96A4),
segments with `length² ≤ 1e-8` dropped (`Subpath::add` @0x5A3C). Records are handed to the
subpath whose index equals `floor(d0)`.

### 5.2 Linear in arc length, cyclic

`[BIN] CGL @0xBD14` `split_segment`: the progress at arc position `s` is the linear
interpolation, in arc length, between the two neighbouring single keyframes:

```
p(s) = p0 + (s − s0) / (s1 − s0) · (p1 − p0)
```

cyclically: before the first keyframe the previous one is the last keyframe at `s − length`
(`Clipper::Clipper` @0xB6B8), after the last the next is the first at `s + length`
(`advance_keyframes` @0xAFF4).

### 5.3 Extremes and speed

The same pass records `kfMin`, `kfMax` (the progress extremes) and the **speed**

```
v = Σ|Δs| / Σ|Δp|     over consecutive single keyframes whose |Δp| ≥ 1e-4
```

(threshold `9.9999997e-05`, `[BIN] CGL @0x132528`). `[INF]` The sum includes the wrapping
pair (last → first + length).

## 6. The cut

### 6.1 Whole-path shortcuts

`[BIN] CGL @0x97B0` (`Transform` constructor):

- `lo = 0` and `hi = 1` exactly, with no subpath transforms → the path passes untouched;
- `hi ≤ 0`, `lo ≥ 1` or `hi ≤ lo` → **everything** is dropped, un-keyframed subpaths
  included. A layer is empty at the start of a Draw On.
- Otherwise, per subpath: no records → replayed whole; else clipped.

### 6.2 Order per subpath

`[BIN] RB @0x1A7923480` / `CGL @0x9E3C` `Transform::emit`: bisection records first (§8),
then corner records (§9), then the plain clip (§6.3–§7).

### 6.3 Which part is kept

`[BIN] CGL @0xB6B8` (`Clipper` constructor), `@0x9E3C` (`emit`), `@0xBF84`
(`clip_segment`):

1. the subpath is emitted only if `max(lo, kfMin) < min(hi, kfMax)`;
2. a bound at a progress extreme is switched off (never cuts):
   - `lo` is off when `kfMin = 0` and `|lo| < 1e-4`, or, when `kfMin ≠ 0`, when
     `lo < kfMin + 1e-4`;
   - `hi` is off when `kfMax = 1` and `|hi − 1| < 1e-4`, or, when `kfMax ≠ 1`, when
     `hi > kfMax − 1e-4`;

   `[INF]` the test was read as "A and B, or C" without its grouping; it is taken as the conditional
   above, the only reading under which a bound beyond `[0, 1]` (an overshoot, §7.3) still
   cuts;
3. a bound that is on is clamped to `[kfMin, kfMax]`;
4. the kept set is `{ s : p(s) > lo (if on) and p(s) < hi (if on) }`. Within each piece
   between keyframes `p` is linear in `s`, so a bound `b` is crossed at the arc fraction
   `(b − p0)/(p1 − p0)` of the piece; Apple splits the original curve there (`CG::*::index`
   maps arc length to the curve parameter) `[BIN]`;
5. the walk is cyclic (`Clipper::run` @0xA6F8): a kept arc that runs past the end of the
   subpath continues from its start; with both bounds off the subpath is emitted whole.

The kept set is a union of arcs. Each arc goes from an **entry** point to an **exit**
point; walking forward, each exit is joined to the next arc's entry by a cap (§7), and the
whole closes.

`[INF]` The model may work on a fine polyline of each subpath (tolerance a small fraction
of the glyph size) instead of splitting curves, and must re-emit a subpath that comes out
whole from its original curves.

## 7. Caps

`[BIN] RB @0x1A7924B18…` / `CGL @0xB1CC` `emit_cap`, for an exit `E` and the next entry `P`
(at the same progress, on the other side of the stroke).

### 7.1 Direction and squaring

With `uE` the unit travel direction at `E` and `uP` the unit direction **backward** at `P`
(both point out of the kept region, along the stroke):

- `dir = uE` when the keyframe interval at `P` is shorter than the one at `E`, else `uP`
  (mask `param_3 < [this+200]`); `[INF]` "interval" is the arc length between the two single
  keyframes around the point;
- `q = (P − E) · dir`; if `q ≤ 0`, `P' = P − q · dir`, `E' = E`; else `E' = E + q · dir`,
  `P' = P` — the base of the cap is moved to the more advanced point, perpendicular to
  `dir`;
- emit `lineto(E')` if it moved.

### 7.2 The synthetic cap

`r = |P' − E'| / 2`, `m = (E' + P')/2`, `u = (P' − E')/|P' − E'|`, apex `A = m + r · dir`.
RenderBox's cap kinds (`Transform[+0x198]`, `[BIN] RB @0x1A7924C58–0x1A7924C9C`):

| kind | shape | address |
|---:|---|---|
| 0 | **round**: `C (E' + κr·dir) (A − κr·u) A`, then `C (A + κr·u) (P' + κr·dir) P'` | 0x1A7924D2C |
| 1, 4, 6 | square: `L E' + r·dir`, `L P' + r·dir`, `L P'` | 0x1A7924DDC, 0x1A7924CA0 |
| 2 | butt: `L P'` | 0x1A7924DC0 |
| 3, 5 | pointed: `L A`, `L P'` | 0x1A7924CF0 |

`κ = 0.5522847498` (`0x3FE1AC51114F0EAF`, `[BIN] RB @0x1A7924D30–D3C`). Then `lineto(P)`
if `P` moved. **The Draw uses kind 0, round** (§1). There is no stroke width: the cap's
diameter is the distance between the two cut points, the outline's own local thickness
(`[CAR]` `wifi`'s tip pair is 190 units apart on a 195-unit-thick arc). `[BIN]` RenderBox's
`LineCap` order is not CoreGraphics' (`rb_line_cap` @0x1A7883A30, table 0x1A7960700 =
`02 00 01 03 04 05 06`).

`[INF]` The two orientation details (which tangent counts as "exit", the round cap's
control points) follow the geometry: the cap bulges out of the kept region and meets both
sides tangentially.

### 7.3 Overshoot extension

`[BIN] CGL @0xB1CC`: at the `hi` cut, when the clamped cut progress `c ≥ 1` and
`x = hi − c > 1e-4`, or at the `lo` cut when `c ≤ 0` and `x = c − lo > 1e-4`, both `E'`
and `P'` move by `normalize(uE + uP) · v · x` — the tip keeps travelling past the last
keyframe at the stroke's own speed `v` (§5.3). Only a range beyond `[0, 1]` triggers it
(Magic Replace's slash `stroke-end` 1.08, [07](07-effects.md) §7.10). `[INF]` The cut is
attributed to `hi` when `hi` is on and the progress at `E` is at least as close to it as to
`lo`.

### 7.4 Recorded caps (flag 2 `lineCap`)

`[BIN] RB @0x1A7922FF0` `subpath_keyframes`, `@0x1A7924B18–0x1A7924BF0` `emit_cap`, computed
once per subpath before any bisection or corner split:

- when `lo ≠ 0`, the `lineCap` record of **lowest** progress gives the **start** cap; when
  `hi ≠ 1`, the one of **highest** progress gives the **end** cap (strict comparisons: the
  first of equals) (0x1A7923248–0x1A7923254);
- the cap shape is the outline arc between the record's two points that holds no other
  keyframe position (0x1A7923134–0x1A792318C): with `a < b` its positions, the arc `a → b`
  unless some other record has a point in `[a, b)`, then `b → a` wrapping;
- at a cut the shape is replayed through the **similarity** that takes its chord
  `c0 → cN` onto `E' → P'` (scale `|w|/|v|`, rotation from `v` to `w`, `translate(−c0)`,
  then translation `E'`), instead of the synthetic cap; the `lo` cut uses the start cap,
  the `hi` cut the end cap (`w22 ? this+0x18 : this+0x20`).

`[CAR]` 165 records, all at progress 0, never two on a subpath (135 layers, 57 drawings):
that one record is both the minimum and the maximum, so a Draw On's travelling tip is capped
with the stroke's recorded **start** shape, turned round.

### 7.5 No end caps

With clip flag `noEndcaps` (§10) every cap is a bare `lineto(P)`, before any squaring
(`flags>>3 & 1` branch).

## 8. Bisection records (flag 8)

`[BIN] CGL @0x9FE0` `emit_bisections`, `@0xA9FC` `BisectState::cut_range`. For the record
`(d0, d1)`: order the points so the forward arc `a → b` is the shorter one
(`Δ = d1 − d0` wrapped into `[−0.5, 0.5]`; `Δ ≥ 0` → `a = d0`). Build two closed contours:
the outline `a → b` closed by the chord, and `b → a` closed by the chord. Re-map every
other record into each half (a record survives in a half when its points lie on that
half's arc), clear the bisection bit on the record that was cut (its two points are the
half's two ends), and clip each half on its own. `[CAR]` 3,230 records, all at progress 0:
the chord is where the drawing **starts**, each half grows away from it (`wifi`'s arcs draw
from the middle outward).

`[INF]` A record with only one point on a half is kept in that half as a degenerate record
at that point, its bisection bit cleared.

## 9. Corner records (flag 1)

`[BIN] RB @0x1A79238F4` / `CGL @0xA224` `emit_corners` (identical bodies). A corner record's
two points sit on the **same** side of the stroke, bracketing the excursion the outline
makes round the outer vertex of a sharp turn (`waveform.path.ecg`'s peaks, `signature`'s
hooks `[CAR]`).

For record `i` with the flag, **not the first nor the last in the array** (`i ≠ 0`,
`i + 1 ≠ count`), and only when `lo` or `hi` lies between the progresses of records `i − 1`
and `i + 1` (0x1A79239D4–0x1A7923A2C):

1. `a → b` is the shorter forward arc between its two points (the tip);
2. `va` = the **partner** of the nearest keyframe point before `a`; `vb` = the partner of
   the nearest keyframe point after `b` (distances wrapped into `±0.5`,
   0x1A7923A78–0x1A7923B30);
3. piece 1 = `cut_range(va, b)` (outline `va → b` closed by a chord), clipped at once;
   piece 2 = `cut_range(a, vb)`, which replaces the subpath; the scan restarts while a
   corner record remains (0x1A7923B50–0x1A7923BF4). `cut_range` keeps a record only when
   both its points are on the arc, and clears the corner flag of the record cut at
   (0x1A792414C).

Both pieces keep the tip: the leg the stroke arrives by has the corner's progress as its
maximum, so once the tip gets there that piece is drawn whole, sharp vertex included, and
the other leg grows out of the corner. Corner flags left at the end are ignored. `[CAR]` 45
records, 24 layers, 24 drawings, 18 in a splittable position.

## 10. Whole-clip flags

`[BIN] CGL` `RawClipStrokeFlags` (getters @0x151FC, 0x15208, 0x351F8, 0x18F0C, 0x35218),
consumed by `Transform::Transform` @0x97B0 and the clipper. **The Draw passes none** (§1).

| value | flag | effect |
|---:|---|---|
| 1 | `inverse` | the C wrapper `CGPathCreateClippedStrokePath` (@0x14A8) builds `[t, 1]` instead of `[0, t]` |
| 2 | `noExtend` | the range is clamped to `[0, 1]`; no overshoot extension (§7.3) |
| 4 | `noRemove` | a subpath whose range is empty is kept (`≤` instead of `<` in §6.3 step 1); `[OBS]` what it then emits |
| 8 | `noEndcaps` | every cap is a straight `lineto` (§7.5) |
| `0x10` | `removeOtherSubpaths` | subpaths with no records are dropped (`subpath_keyframes` @0x99F0) |

`[BIN] RB @0x1A7877C10` RenderBox uses bit 7 (`0x80`) of its own transform flags for "join
first".

Per-record flags, for reference ([06](06-drawing.md) §6.1): 1 `corner` (§9), 2 `lineCap`
(§7.4), 4 `invertJoined` (§4), 8 `bisectionPoint` (§8).

## 11. Riders: clip-stroke attachments

An attachment makes subpaths of one family layer (an arrowhead: the **rider**) follow the
drawing tip of another layer's stroke instead of appearing whole. `[BIN] RB @0x1A782116C`
`Glyph::resolve_draw_attachments` (at load) and `@0x1A7825014`
`Glyph::Layer::resolve_draw_transforms` (per draw); `@0x1A7925188`, `@0x1A79251F0`
`AttachmentResolver`.

### 11.1 The data

Per attachment `{flags, targetLayer, targetSubpath, dataIndex, riders}` declared by family
layer `F` ([06](06-drawing.md) §6.2), with `D = drawAttachmentData[dataIndex] = {a, b,
anchorX, anchorY}` (06 §6.3). `flags` is `ClipStrokeAttachmentFlags` `[BIN] CGL`: 1
`ignoreTranslation`, 2 `ignoreRotation`, 4 `hasStartProgress`. `[CAR]` On all 9,357
attachments: format 1, flags 4, one rider. Target and rider subpaths are numbered **per
family layer**, counted across its nodes in document order, before any join.

**Skipped outright**: flags with `ignoreTranslation` and `ignoreRotation` but not
`hasStartProgress` (`[BIN] RB @0x1A7821478`); `[INF]` a `dataIndex` past `data-d` (`[CAR]` 45
attachments); `[INF]` a target with no stroke keyframes, or not animating its stroke in this
effect.

### 11.2 The hook

`[BIN] RB @0x1A79251F0`: among the records of the target subpath (`floor(d0) =
targetSubpath`), those with `|progress − a| < 1e-4` (`9.99999974e-05`, 0x1A795E098); if
several, the one whose point-pair midpoint is nearest the anchor. The anchor is in glyph
points, y up (`y' = glyph[+0x44] − y`), divided by the layer scale. `[INF]` The model reads
the anchor in viewBox units with y measured up from the viewBox's bottom edge and maps it
into path space through the inverse of `transform`; it only breaks ties.

The hooked record's two points at rest, in the resolver's order, are the **rest chord**
`P0 → P1`: `P0` is the start of the shorter forward arc between them — `d0` first when
`|d1 − d0| ≤ 0.5` and `d0 ≤ d1`, or when `|d1 − d0| > 0.5` and `d1 < d0` (raw `d` values).

`[CAR]` 36 attachments (`arrow.trianglehead.turn.up.right.circle.fill` variants) find no
record at progress `a` under this numbering. `[OBS]`

### 11.3 The tip

`[BIN] RB @0x1A7825014`: a `Transform` is run over the **target** layer with the target's
current range (`lo`, `hi`; widened by `1e-4` each way when `|hi − lo| < 1e-4`) and flags
`0xc` (`noRemove | noEndcaps`) only to record where its tip is (`record_cap`, `[BIN] CGL
@0xAF04`). The **tip chord** `C0 → C1` is the cut chord of the cap (exit `E` → entry `P`,
raw, before squaring). `[INF]` Which cap: RenderBox pushes the id of a flagged keyframe as
the clipper passes it and records it with the next cap; the model takes the first cap
whose **skipped** arc (from `E` forward to `P`) holds a point of the hooked record. Under
that reading a Draw On's tip cap carries the rider and a Draw Off (only the `lo` end cut)
records nothing, so the rider stays put.

### 11.4 Hidden

`[BIN] RB @0x1A7825194–0x1A7825598`. With `span = hi − lo` of the target, `b' = b` with
`hasStartProgress` (else 0), and the hide progress `a' = a` when hooked (`b` when not), 1
without `hasStartProgress` (0x1A7821570):

```
hidden = span < 0.9999
if 1e-4 ≤ span < 0.9999:  hidden = (lo == 0) ? hi < b'  :  a' < lo
```

Draw On: hidden until the tip reaches `b`. Draw Off: hidden once `lo` passes `a`.

### 11.5 Scale

Not hidden, and not (`ignoreTranslation` and `ignoreRotation`): `s = 1`, and with
`hasStartProgress`:

```
lo == 0:   s = 0.5 + 0.5 · clamp((hi − b) / (min(b + 0.2 / X, 1) − b), 0, 1)
lo != 0:   s = the rider layer's stroke-attachment-scale
```

`X` is a per-target float at `PathParams+0x10` `[BIN]`. `[INF]` `X` is the target's stroke
length in point sizes (§3, the number the Draw duration uses): the head grows from half
size over the first 0.2 point sizes of travel past `b`; `0.2 / X ≥ 1 − b` (any `X ≤ 0.2`
when `b = 0`) makes it `s = 0.5 + 0.5 · (hi − b)/(1 − b)`. The `stroke-attachment-scale`
list (16) is the Draw Off one ([07](07-effects.md) §7.8): 1 during the stroke, then a
linear ramp to 0.5 over 1/30 s, then 0.

### 11.6 The transform

- tip found: `p ↦ R · s · (p − P0) + C0`, with `R` the rotation by `angle(C1 − C0) −
  angle(P1 − P0)`, the identity with `ignoreRotation`;
- no tip (the target is not being cut where the hook is) and `s ≠ 1`: `p ↦ s · (p − m) +
  m`, `m` the midpoint of `P0, P1`;
- otherwise the identity.

`[BIN] RB @0x1A78250A0` Nothing is resolved for a declaring layer drawn whole and unscaled
(range `[0, 1]` and attachment scale 1).

### 11.7 Where it applies

`[INF]` A rider is a **subpath**, and in the catalog it shares its node with the stroke it
rides (`arrow.left.to.line`: bar, chevron and shaft are one path). So the result is a
per-subpath transform (or "hidden") on the model layer holding that subpath, applied to the
subpath **before** the clip and before the layer's extra transform. A hidden subpath is
collapsed to its start point rather than removed, so later subpaths keep their indices. The
rider subpath has no records of its own (`[CAR]` 9,321 of 9,357), so the clip draws it
whole while its layer's range is non-empty. Riders are resolved after every layer's range
is known, since they follow the target's final range.

## 12. Worked examples

Numbers to assert in tests. Coordinates are path units, y down. Tolerances: `1e-6` on
exact constructions, `1e-3` where an arc length is approximated.

### 12.1 A straight stroke

One layer, one subpath, a 95 × 5 bar:

```
path:                 M 0 0  L 95 0  L 95 5  L 0 5  Z
strokeKeyframes:      { flags 0, progress 0, d0 0,     d1 0.975 }
                      { flags 0, progress 1, d0 0.475, d1 0.5   }
(data-clipstroke-keyframes = "0  0 0 0 0.975  0 1 0.475 0.5")
```

Arc length 200: top edge `s ∈ [0, 95]`, right `[95, 100]`, bottom `[100, 195]`, left
`[195, 200]` (the closing segment). Single keyframes `(0, 0) (95, 1) (100, 1) (195, 0)`.
Field: `p = s/95` on the top, 1 on the right, `1 − (s − 100)/95` on the bottom, 0 on the
left. `kfMin = 0`, `kfMax = 1`, speed `v = (95 + 95)/(1 + 1) = 95` (the centreline).

**Stroke length and Draw duration** (with `strokeLength = L_path / 2048`, §3): `x =
0.17182131 · 95 / 2048 = 0.0079702`, `dur = 0.1470933` s.

**Draw On at `e = 0.5`**, range `[0, 0.5]`: `lo` is off (`kfMin = 0`, `|lo| < 1e-4`), `hi =
0.5` cuts. Kept: `p < 0.5`, i.e. `s ∈ [147.5, 200] ∪ [0, 47.5)`, one cyclic arc from entry
`s = 147.5` to exit `s = 47.5`. `E = (47.5, 0)`, `P = (47.5, 5)`, `uE = (1, 0)`, `uP = (1,
0)`; both intervals are 95 long, so `dir = uP = (1, 0)`; `q = 0`, no squaring; `r = 2.5`,
`A = (50, 2.5)`, `κr = 1.3807119`. Result:

```
M 47.5 5
L 0 5
L 0 0
L 47.5 0
C 48.880712 0  50 1.119288  50 2.5
C 50 3.880712  48.880712 5  47.5 5
Z
```

The left half of the bar with a half-disc cap of radius 2.5 bulging toward +x.

**Draw Off at `e = 0.5`**, range `[0.5, 1]`: `hi` is off, `lo = 0.5` cuts. Kept `p > 0.5`:
`s ∈ (47.5, 147.5)`. `E = (47.5, 5)` (exit at `s = 147.5`), `P = (47.5, 0)`, `uE = uP =
(−1, 0)`, `dir = (−1, 0)`, `A = (45, 2.5)`:

```
M 47.5 0
L 95 0
L 95 5
L 47.5 5
C 46.119288 5  45 3.880712  45 2.5
C 45 1.119288  46.119288 0  47.5 0
Z
```

**Edges**: range `[0, 1]` → the path unchanged; `[0, 0]` → empty (Draw On at its start);
`[0, 1e-5]` → `hi` cuts at `s = 0.00095` (top) and `s = 194.99905` (bottom): the left
edge and a sliver of each long edge, capped.

### 12.2 A curve

A quarter ring centred on the origin, outer radius 60, inner 40, `κ = 0.5522847498`:

```
path:  M 60 0
       C 60 33.137085  33.137085 60  0 60
       L 0 40
       C 22.091390 40  40 22.091390  40 0
       Z
strokeKeyframes:   { 0, progress 0, d0 0,         d1 0.8985295 }
                   { 0, progress 1, d0 0.4782354, d1 0.5797059 }
```

Arc lengths (the cubics, not true circles): outer `Lo = 94.26100`, radial `20`, inner
`Li = 62.84067`, closing `20`; total `197.10167`. The `d` values are those arc positions
over the total: `(Lo + 20 + Li)/197.10167`, `Lo/…`, `(Lo + 20)/…`. Speed `v = (Lo + Li)/2 =
78.55083` (the centreline of radius 50 would be 78.53982).

**Draw On at `e = 0.5`**: the cut points are where each arc is half covered by arc length,
which for these symmetric cubics is the parameter midpoint:

```
E (exit, outer arc)  = (42.426407, 42.426407)
P (entry, inner arc) = (28.284271, 28.284271)
uE = uP = (−0.7071068, 0.7071068),   q = 0,   r = 10,   A = (28.284271, 42.426407)
```

The kept outline is the inner arc's second half from `P` to `(40, 0)`, the closing edge to
`(60, 0)`, the outer arc's first half to `E`, then the round cap through `A` back to `P`. A
test asserts `E`, `P`, `A` within `1e-3`, and that the result has exactly one subpath with
two cubic cap segments.

### 12.3 A rider following the tip

The bar of §12.1 plus a chevron as a second subpath of the **same** layer (family layer 0):

```
path:          M 0 0 L 95 0 L 95 5 L 0 5 Z   M 95 -5 L 105 2.5 L 95 10 Z
strokeKeyframes: as §12.1 (both records on subpath 0)
attachments:   [{ flags 4, targetLayer 0, targetSubpath 0, dataIndex 0, riders [1] }]
                                                (06 §6.2: "1 4 0 0 0 1")
drawAttachmentData: [{ a 1, b 0, anchorX 0, anchorY 0 }]      (data-d = "0 1 0 0 0")
```

Hook: the only record of subpath 0 at progress 1, `(0.475, 0.5)`; `|0.5 − 0.475| ≤ 0.5`
and `0.475 ≤ 0.5`, so `P0 = (95, 0)`, `P1 = (95, 5)`.

**Draw On at `e = 0.5`** (range `[0, 0.5]`): span 0.5, `lo = 0`, `hi = 0.5 ≥ b = 0` →
visible. The cap of §12.1 skips `s ∈ [47.5, 147.5]`, which holds the hook's points (95,
100): tip chord `C0 = (47.5, 0)`, `C1 = (47.5, 5)`. Rotation `90° − 90° = 0`. Scale with `X
= 95/2048` (so `0.2/X > 1`): `s = 0.5 + 0.5 · 0.5 = 0.75`. The rider's transform is `p ↦
0.75 · (p − (95, 0)) + (47.5, 0)`:

```
(95, −5)  → (47.5, −3.75)
(105, 2.5) → (55, 1.875)
(95, 10)  → (47.5, 7.5)
```

The chevron sits on the tip, three quarters of its size; the clip then draws it whole
(subpath 1 has no records).

**Draw On at `e = 1`**: range `[0, 1]` → nothing is resolved (§11.6); the chevron is at
rest. **At `e = 0`**: span 0 < 1e-4 → hidden (and the layer is empty anyway).

**Draw Off at `e = 0.5`** (range `[0.5, 1]`): `lo ≠ 0` → hidden iff `a = 1 < lo`: visible.
The only cap skips `s ∈ [147.5, 247.5]` (wrapping), which does not hold 95 or 100: no tip.
`s` = the layer's `stroke-attachment-scale`, 1 during the stroke → identity: the chevron
stays at the bar's end. After the stroke ends (`start + dur`) the target's range holds the
plateau `[0.99989998, 1]` for 1/30 s: `stroke-start` is `1 − 1e-4` stored as **float32**
(`0.99989998`, [07](07-effects.md) §2.8), so `span = 1 − 0.99989998 ≈ 1.0002e-4`, which is
`≥ 1e-4` (float32 `9.99999974e-05`) and `< 0.9999`; `lo ≠ 0` and `a = 1 < 0.99989998` is
false → the chevron is **visible** throughout the plateau. (Use the float32 value: it is
what RenderBox stores. In double from the decimal `0.9999` the span is
`9.99999999999989e-5`, still above the float32 threshold `9.99999974e-05` but below a
double `1e-4`; only an all-double comparison would flip the test.) Meanwhile `stroke-attachment-scale` ramps linearly from 1 to 0.5 over the
1/30 s, scaling the chevron about `m = (95, 2.5)` (at 0.5: `(105, 2.5) → (100, 2.5)`), then
jumps to 0. When the plateau ends the range becomes `[1, 1]`: empty, and the chevron is
hidden.

### 12.4 A non-strokable layer in a Draw

A layer whose family has no keyframes and no attachments takes Draw On as the "up" Appear
([07](07-effects.md) §7.7): with one group, `clip-alpha 0 →(0.25, c14)→ 1` and `scale 0.75
→(0.25, c15)→ 1` from 0; at `t = 0.125`:

| quantity | value |
|---|---|
| `curve14(0.5)` (`0.33, 0, 0.67, 1`, symmetric) | `0.5` |
| alpha | `0.5` |
| `curve15(0.5)` (`0.33, 0, 0.2, 1`) | `≈ 0.791257` |
| scale `0.75 + 0.25 · curve15(0.5)` | `≈ 0.947814` |

(Control points as float32; tolerance `1e-6`.)

## 13. Open questions

- `[OBS]` `fontMatchingScaleFactor` (§3) and RenderBox's `PathParams+0x10` writer (§11.5).
- `[OBS]` The `invertJoined` seam rule, bit-exact (§4).
- `[OBS]` What tells cap kind 3 from 5 and 4 from 6 (§7.2); `noRemove`'s output on an empty
  range (§10).
- `[OBS]` Version-1 keyframe text (several keyframe sets, [06](06-drawing.md) §6.1): parsed by
  CoreUI, absent from the catalog.
- `[OBS]` The 45 attachments past `data-d` and the 36 without a hook (§11.1, §11.2).
- `[OBS]` Per-master interpolation of the keyframes and `data-d`: CoreUI interpolates both
  across the three masters (`_createInterpolatedDrawAttachmentDataStoreWithWeight:…`,
  `ClipStrokeKeyframeSourceBuilder.merge(ultralight:regular:black:globalIndices:)`), not read;
  each master's document carries its own.
