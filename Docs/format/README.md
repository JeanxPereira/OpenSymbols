# Catalog format notes

Reverse-documented notes on the on-disk format of the SF Symbols catalog, as needed by the decoder.

## Seal legend

Every claim in these docs carries one seal:

- `[BIN]` read from an Apple binary
- `[CAR]` measured over the catalog
- `[INF]` inference
- `[OBS]` open question

## Index

Read in order; each document numbers its sections (`§N.M`) so code can cite them as
`Docs/format/03 §3.4`.

1. [01-bom-and-car.md](01-bom-and-car.md) — the `Assets.car` container: BOM store, B+trees, `KEYFORMAT`, `FACETKEYS`, `csiheader`, `DWAR`, and what the rendition-key axes mean.
2. [02-bvg-document.md](02-bvg-document.md) — the `BVG ` document: header and field widths, string pool, the 89 predefined atoms, node tree, attribute dispatch.
3. [03-bvg-paths-and-numbers.md](03-bvg-paths-and-numbers.md) — the nibble codec: constant tables, path commands, flag bytes, numbers, packed pairs, numeric lists.
4. [04-style-block.md](04-style-block.md) — the style block: class records and the four family prefixes, rules and declarations, the `-sfsymbols-*` property census and vocabularies.
5. [05-metadata.md](05-metadata.md) — the bundle and app metadata files, `colors-26.csv`, and how a name resolves to a rendition.
6. [06-drawing.md](06-drawing.md) — how a document becomes a `Drawing`: layers, class selection, per-mode layer style (paint, opacity, knockout), every property's field, Draw data, shape groups.
