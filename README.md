# OpenSymbols

OpenSymbols is a TypeScript toolkit that turns your own copy of Apple's SF Symbols catalog into an icon package for the web, in the spirit of lucide-react. A decoder reads the catalog files and a CLI generates the package from them.

## Bring your own catalog

This repository and its npm packages contain no Apple data. You supply the catalog from your own Mac and generate the icon package locally. Nothing derived from the catalog is committed or published from here.

## The catalog root

The CLI reads a catalog root directory, given with `--catalog DIR` or `$SF_CATALOG_DIR`:

```
<root>/
  public/        the contents of CoreGlyphs.bundle/Contents/Resources, flattened:
    Assets.car   the symbol drawings
    *.plist      the bundle's metadata (name_availability.plist, symbol_search.plist, ...)
    *.strings    name_aliases.strings and the other .strings files
  app/           optional: the SF Symbols app's Resources/Metadata files, plus colors-26.csv
```

`CoreGlyphs.bundle` is in `/System/Library/PrivateFrameworks/SFSymbols.framework/Versions/A/Resources/`
on a Mac. Keep the root outside this repository, or under `catalog/`, which git ignores.

## Running the decoder's checks

```sh
pnpm install && pnpm build
node packages/cli/dist/main.js gate --catalog /path/to/root
node packages/cli/dist/main.js dump --all --out catalog.dump.txt --catalog /path/to/root
```

`gate` decodes every drawing, checks that each symbol's three masters have the same shape,
and prints `documents=… failures=… incompatible=… skipped=…`; it exits 0 only when all
three counts are zero, 1 otherwise, and 2 on a usage error or a missing catalog.
`dump --all` writes the canonical text form of every drawing, the decoder's regression
baseline; it writes to `FILE.tmp` and renames it only when every drawing dumped. Both
outputs stay on your machine: `*.dump.txt` is git-ignored.

## License

The tooling is MIT licensed. The symbols themselves are Apple's and remain under Apple's license; you are responsible for using generated output in line with those terms.
