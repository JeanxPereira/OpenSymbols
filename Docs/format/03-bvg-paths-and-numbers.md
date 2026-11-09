# 03 — `BVG ` paths, numbers and numeric lists

The binary layer under every path (`d`) and every numeric list (`viewBox`,
`data-clipstroke-keyframes`) of a `BVG ` document ([02](02-bvg-document.md) §5.1). It runs
on nibbles.

`[BIN]` facts below are `CoreUI 26A5416b`:

| piece | symbol | address |
|---|---|---|
| path body | `CSIBVGPathDecoder::createDecodedPath` | `0x18b5500a4` |
| flag byte | `CSIBVGPathDecoder::ReadState::consumeFlag` | `0x18b5509b8` |
| nibble reader | `CSIBVGNibbleReader::readNibble` / `readByte` / `readValue` | `0x18b550964` / `0x18b550790` / `0x18b5507fc` |
| numbers | `decodeGenericValue(CSIBVGNibbleReader&, uint8_t, double&)` | `0x18b550a54` |
| command letters | `CSIBVGCoding::CommandByte::resolvedSVGCommand` | `0x18b550d14` |
| operand counts | `CSIBVGCoding::CommandByte::valuesPerSet` | `0x18b543680` |
| numeric lists | `CSIBVGNumericListDecoder::createDecodedString` | `0x18b5504ec` |

## 1. The nibble reader

### 1.1 Nibbles

`[BIN]` A cursor `(pos, half)` over the blob's bytes, starting at `(0, false)`.

```
readNibble():
    if pos >= length: ran dry
    v = half ? (bytes[pos] & 0xF) : (bytes[pos] >> 4)      high nibble first
    if half: pos += 1                                      advance only after the LOW nibble
    half = !half
    return v

peekNibble():  the same value, without moving
```

### 1.2 Bytes

`[BIN]` `readByte` has two paths:

- aligned (`half` false): return `bytes[pos]`, `pos += 1`;
- mid-byte (`half` true): splice the low nibble of `bytes[pos]` with the high nibble of
  `bytes[pos+1]` — `((bytes[pos] & 0xF) << 4) | (bytes[pos+1] >> 4)` — and `pos += 1`;
  `half` stays true. Runs dry if `pos + 1` is past the end.

The reader is **at end** when `pos >= length`. A stream with one nibble left
(`half` true, `pos = length - 1`) is not at end, but `readByte` runs dry on it.

### 1.3 `read_value`

`[BIN]`

```
readValue(n):
    n == 0: return 0                  (reads nothing)
    n == 1: return readNibble()
    n == 2: return readByte()
    else:   v = 0; repeat n times: v = (v << 4) | readNibble(); return v
```

Nibbles are big-endian within a value. `[INF]` Widths reach 10 nibbles (40 bits, from
`decimalWidths[3]`): accumulate in a type that holds at least 40 bits exactly (a JS
`number` does; 32-bit integer arithmetic does not). `[CAR]` The widest value returned
on `26A5416b` is 234,029,776, but the format allows more.

### 1.4 End of stream is not an error

`[BIN]` `createDecodedPath` branches to its epilogue when `readByte` returns false and
returns the path built so far. A stream whose last command ends on a half-byte leaves one
nibble of padding. A decoder that throws there fails on perfectly good symbols. Running
dry anywhere inside a path or list ends it with what has been decoded (§3.6, §4).

## 2. Constant tables

`[BIN] CoreUI 26A5416b`, read from the image:

| table | address | value |
|---|---|---|
| `integerWidths` | `0x18b596420` | `[4, 8, 12, 32]` |
| `halfNibbleDecimalWidths` | `0x18b596424` | `[10, 14, 26, 38]` |
| `decimalWidths` | `0x18b596428` | `[12, 16, 28, 40]` |
| `exponentWidths` | `0x18b59642c` | `[8, 12]` |
| `kIntegerSmallBits` | `0x18b5963e0` | `[4, 6, 8, 10]` |
| `kIntegerLargeBits` | `0x18b596400` | `[8, 10, 12, 14]` |
| `kIntegerSmallMax` | `0x18b5963c0` | `[7, 31, 127, 511]` |
| `signTable` | `0x18b596430` | `[+1.0, -1.0]` |
| `kPowersOf10` | `0x18b596490` | `1e0, 1e1, …, 1e20` (21 doubles) |
| `valuesPerSet` | `0x18b595070` | `[6, 4, 4, 2, 1, 1, 0, 2, 6, 4, 4, 2, 1, 1, 0]` |

All widths are in **bits**; a width `w` is read as `readValue(w >> 2)` nibbles.

`valuesPerSet` is indexed by `high - 1` (§3.2): `6, 4, 4, 2, 1, 1, 0` for `C, S, Q, T, H,
V, Z`, the same for the relative forms, and 2 for `L`/`M` (the default). That is exactly
SVG's operand count per command. `[INF]` A decoder does not need it to decode — the flag
bytes give every run length (§3.4) — but it is the cross-check that a decoded command has
a sensible operand count. `kIntegerSmallMax` is listed for completeness; nothing below
reads it.

## 3. Path data (`d`)

### 3.1 Path header

`[BIN]`

```
u8           0x00                 the stream must start with a zero byte
readValue(4)                      total value count     (capacity hint; ignore)
readValue(4)                      command count         (capacity hint; ignore)
commands, until the reader runs dry
```

A first byte other than 0 is an error. `[INF]` So is a stream too short for the two
counts.

### 3.2 Command byte

`[BIN]` Each command starts with `cmd = readByte()` (which may splice two half-bytes,
§1.2). If it runs dry, the path is complete. **High nibble = command, low nibble = encoding
flags** (§3.3).

| high | command | high | command |
|---:|---|---:|---|
| 0 | `L`, or `M` when there is no current point | 8 | `l`, or `m` when there is no current point |
| 1 | `C` | 9 | `c` |
| 2 | `S` | 10 | `s` |
| 3 | `Q` | 11 | `q` |
| 4 | `T` | 12 | `t` |
| 5 | `H` | 13 | `h` |
| 6 | `V` | 14 | `v` |
| 7 | `Z` (never relative) | 15 | — |

Absolute versus relative is bit 7: the encoder maps the letter to a nibble and XORs `0x80`
for a lowercase letter. Entry 0 is "`L`, or `M` with no current point"; the binary computes
the move as `'L' + 1`.

**Current point** `[BIN]`: there is none at the start of a path and none right after a `Z`.
Every command other than `Z` establishes one. So the first command, and the first one after
each `Z`, decodes high nibble 0 as `M` (8 as `m`).

`Z` (high 7) takes no operands and reads nothing more, whatever its low nibble.

`[INF]` High nibble 15 is not a command: a byte `0xF0`–`0xFF` in command position is an
error. No document carries one `[CAR]`.

### 3.3 Low nibble of the command byte

`[BIN]`

| bit | meaning |
|---:|---|
| 0–1 | `width`: nibble width of the *set count* that follows; **0 = immediate mode** |
| 2 | odd operand count: after decoding, drop the last value (it is padding) |
| 3 | operands are **packed pairs** (§5.4), not pairs of generic numbers (§5) |

### 3.4 Sets and the flag byte

`[BIN]` After the command byte:

**Counted mode** (`width ≠ 0`):

```
sets  = readValue(width)
flags = readByte()
scale = 0
```

**Immediate mode** (`width = 0`) — one nibble carries everything:

```
nib   = readNibble()
flags = 0x08 | ((nib >> 2) & 3)     bit 3 forced: one pair, count immediate
scale = nib & 3
sets  = 1
```

`[CAR]` Immediate mode is the common case: on a sample of 400 documents, 1,405 of 1,538
first commands use it.

The **flag byte** (`consumeFlag`):

| bit | meaning |
|---:|---|
| 0 | sign of the **second** value of each pair: `signTable[bit]` |
| 1 | sign of the **first** value of each pair: `signTable[bit]` |
| 2 | read one nibble and make it the new `scale` |
| 3 | count is immediate: `pairs = (flags >> 4) + 1` |
| 4–7 | if bit 3 is clear: `pairs = readValue(flags >> 4)` |

### 3.5 Runs

`[BIN]` The operands are read as runs of pairs, one run per flag byte:

```
loop:
    if flags bit 2: scale = readNibble()
    pairs = (flags bit 3) ? (flags >> 4) + 1 : readValue(flags >> 4)
    sets -= 1
    repeat pairs times, while the reader is not at end:
        (a, b) = packed ? packedPair(scale) : (genericValue(scale), genericValue(scale))
        append a * signTable[flags bit 1], b * signTable[flags bit 0]     (zero stays +0)
    if sets <= 0 or the reader is at end: stop
    flags = readByte()
```

Values are appended **in pairs** whatever the command's arity; `H`, `V` and odd-arity
data rely on bit 2 of the command byte (§3.3) to drop the padding value.

**No `-0`.** `[BIN]` A zero is never multiplied by the sign (the binary guards with an
`fcmeq` test), so `-0` never appears in decoded output.

`[INF]` `pairs = readValue(0)` is 0: a run with no pairs is legal and only consumes its
flag byte.

### 3.6 Ending a command and a path

`[BIN]` After its runs, a command is emitted with its values; if the command byte's bit 2
is set and at least one value was decoded, the last value is dropped first. A command whose
runs decoded nothing is still emitted (with no operands). If the reader ran dry inside the
runs, the command is emitted with what it has and the path ends.

## 4. Numeric lists

`[BIN]` `viewBox` and `data-clipstroke-keyframes` use the same run machine without command
bytes:

```
u8    0x00                        must be zero
u8    header
      count = (header bit 6) ? header & 0x1F : readValue(header & 3)
u8    first flag byte             (readByte)
      runs exactly as in §3.5, with scale = 0 at the start and sets = count
```

| header bit | meaning |
|---:|---|
| 7 | operands are packed pairs (§5.4) |
| 6 | `count` is immediate, in bits 0–4 |
| 5 | odd length: drop the last decoded value |
| 0–1 | if bit 6 is clear: nibble width of `count` |

`count` plays the role of `sets`: the number of flag-byte runs. A first byte other than 0
is an error. `[INF]` If the stream ends right after the header, the list is empty.

`[INF]` A `count` of 0 describes no runs; the list is empty. No document on `26A5416b`
carries one (every `viewBox` has four values), so the binary's behaviour on it was not
needed and is not read.

`[CAR]` Decoded, `wifi` Ultralight's `viewBox` is `0 0 10.968744 7.959957`, and one of its
keyframe lists is `0 8 0 0.72917 0.230054 0 1 0.421877 0.497948 0 1 0.96185 0.037739`.

## 5. Numbers

### 5.1 `decodeGenericValue`

`[BIN]` Decodes one non-negative number at the current `scale`:

```
n = readNibble()
if scale == 0:
    integer = n & 7
else:
    bits    = integerWidths[(n >> 1) & 3]
    integer = ((n & 1) << bits) | readValue(bits >> 2)
value = integer
if (n >> 3) & 1 == 0: return value                  no fraction, no exponent

f = readNibble()
if (f >> 2) & 1: return applyExponent(value)        exponent, no fraction

g = readNibble()
switch f & 3:
  0: frac  = g
     zeros = 0
  1: w     = halfNibbleDecimalWidths[(g >> 2) & 3] - 2
     frac  = readValue(w >> 2) | ((g & 3) << w)
     zeros = 0
  2: frac  = readValue(decimalWidths[g & 3] >> 2)
     zeros = (g >> 2) & 3
  3: h     = readNibble()
     w     = halfNibbleDecimalWidths[(h >> 2) & 3] - 2
     frac  = readValue(w >> 2) | ((h & 3) << w)
     zeros = g

if frac != 0: value += frac / 10^(digits(frac) + zeros)
if (f >> 3) & 1: value = applyExponent(value)
return value
```

`digits(frac)` is the decimal digit count of `frac`. The fraction is stored as an integer
and divided by the power of ten its own length implies, plus any leading zeros the encoder
recorded separately: `0.005258998` is `frac = 5258998`, `zeros = 2`.

`[INF]` `integer` can reach 33 bits (`(n & 1) << 32`) and `frac` 40 bits: keep both in
exact arithmetic. Compute `10^k` from `kPowersOf10` where `k ≤ 20`.

### 5.2 `applyExponent`

`[BIN]`

```
applyExponent(value):
    g = readNibble()
    if (g >> 2) & 1:
        e = readValue(exponentWidths[g & 1] >> 2)
        p = e <= 20 ? kPowersOf10[e] : 10^e
        value = (g >> 1) & 1 ? value / p : value * p
    return value
```

`[CAR]` No document on `26A5416b` takes the multiplying branch (bit 1 clear). That half of
the rule rests on the binary alone; no catalog value checks it.

`[INF]` `e` reaches 4,095 with the 12-bit width, and `10^e` is not a finite double from
`e = 309`. A power that overflows, or a product that does, is malformed and an error rather
than `Infinity` or `NaN`: no geometry on `26A5416b` is that large, so such a value means the
stream is misread.

### 5.3 Worked examples

`[INF]` Derived by hand from §5.1:

| scale | nibbles | value | how |
|---:|---|---:|---|
| 0 | `3` | 3 | `3 & 7`, bit 3 clear |
| 0 | `B 0 5` | 3.5 | integer `0xB & 7 = 3`; bit 3 set; `f = 0` → kind 0, `g = 5`; `3 + 5/10` |
| 1 | `2 1 4` | 20 | `bits = integerWidths[1] = 8`; `readValue(2) = 0x14`; `(0 << 8) \| 20` |

### 5.4 Packed pairs

`[BIN]` When packed (command byte bit 3, or numeric-list header bit 7), two non-negative
integers share one field:

```
s    = scale & 3
head = peekNibble()                                 not consumed separately
wa   = (head & 8) ? kIntegerLargeBits[s] : kIntegerSmallBits[s]
wb   = (head & 4) ? kIntegerLargeBits[s] : kIntegerSmallBits[s]
raw  = readValue((wa + wb) >> 2)
b    = raw & ((1 << (wb - 1)) - 1)
a    = (raw >> (wb - 1)) & ((1 << (wa - 1)) - 1)
```

Each half keeps one bit less than its width: the two selector bits in the first nibble are
part of the field being read.

`[INF]` `scale` reaches here as a raw nibble (0–15) from the flag byte, and the two tables
have four entries; it is masked to two bits. `[CAR]` Over the 4,106,832 packed pairs of the
two `26A5416b` catalogs, `scale` never exceeds 3, so the mask never changes a value.

## 6. Output

A decoded path is a list of `(letter, values)` commands in SVG terms; the letters are those
of §3.2 and the values are the operands in order. Values are doubles. Nothing here
transforms coordinates: they are in the path space inside `<g id="s">`
([06](06-drawing.md) §2).
