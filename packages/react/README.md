# @opensymbols/react

React components for OpenSymbols: renders the SF Symbols icons that `opensymbols generate` builds,
at any weight and in every rendering mode.

No Apple data ships in this package. The icons come from a package you generate from your own
copy of the SF Symbols catalog (`CoreGlyphs.bundle`) with the `opensymbols` CLI; this package is
the runtime that package depends on.

## Install

```sh
npm install @opensymbols/react react react-dom
```

React 19 or later. ESM only: use `import`.

## Use

Generate your icon package first (`npx @opensymbols/cli generate --catalog DIR --out ./my-icons`),
install it, then import the icons by name:

```tsx
import { Wifi } from "opensymbols";

<Wifi size={32} weight="semibold" mode="hierarchical" color="#0a84ff" />
```

`createIcon` and `SymbolIcon` render symbol data directly, for data you load yourself. The
components carry `"use client"`, so they can be imported from React Server Components trees.

The props, the layouts and the effects are described in the README at the root of the
OpenSymbols repository.

## License

MIT.
