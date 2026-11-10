# @opensymbols/core

The framework-free runtime of OpenSymbols: the format of the generated symbol data, its decoding,
weight and scale interpolation, layer paint resolution and SVG building. `@opensymbols/react`
and `@opensymbols/animate` are built on it.

No Apple data ships in this package. The symbol data comes from a package you generate from your
own copy of the SF Symbols catalog (`CoreGlyphs.bundle`) with the `opensymbols` CLI.

## Install

```sh
npm install @opensymbols/core
```

ESM only: use `import`.

## Use

Most apps use it through `@opensymbols/react` and never import it. To render a symbol without
React, decode its data and build the SVG tree:

```ts
import { buildSvg, decodeSymbol, type RenderOptions } from "@opensymbols/core";

const data = decodeSymbol(wire); // `wire`: one symbol's data from a generated package
const { root } = buildSvg(data, options); // options: RenderOptions
```

`root` is a plain `{ tag, attrs, children }` tree to serialize or hand to any renderer.
`RenderOptions` types the size, weight, layout, rendering mode, colors, appearance and
direction. The format is described in the README at the root of the OpenSymbols repository.

## License

MIT.
