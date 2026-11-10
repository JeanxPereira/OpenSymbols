# opensymbols

The OpenSymbols command line: it builds an icon package of React components from your own copy
of Apple's SF Symbols catalog.

No Apple data ships in this package or in any `@opensymbols/*` package. You bring the catalog:
`opensymbols generate` reads `CoreGlyphs.bundle` (and, optionally, the SF Symbols app's metadata)
from your Mac and writes the icons into a package on your machine.

## Install

```sh
npm install --save-dev opensymbols
```

Requires Node 22.12 or later.

## Use

```sh
npx opensymbols generate --catalog /path/to/catalog-root --out ./my-icons
npx opensymbols demo --package ./my-icons
npx opensymbols --help
```

`--catalog` (or `$SF_CATALOG_DIR`) is a directory whose `public/` holds the contents of
`CoreGlyphs.bundle/Contents/Resources`. The generated package depends on `@opensymbols/react`
and `react`; install them in your app next to it:

```sh
npm install @opensymbols/react react react-dom
npm install --install-links ./my-icons
```

```tsx
import Wifi from "opensymbols-local/Wifi";

<Wifi size={32} weight="semibold" mode="hierarchical" />
```

`gate` and `dump` check the decoder against your catalog. The catalog layout, every option, the
icon props and the effects are described in the README at the root of the OpenSymbols repository.

## License

MIT. The symbols themselves are Apple's and remain under Apple's license; you are responsible
for using generated output in line with those terms.
