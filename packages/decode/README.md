# @opensymbols/decode

A decoder for Apple's SF Symbols catalog: the BOM store and asset catalog (`Assets.car`), the
vector glyph drawings, and the symbol metadata in its property lists and `.strings` files.
The `opensymbols` CLI uses it to read the catalog it generates icons from.

No Apple data ships in this package. It reads the copy of `CoreGlyphs.bundle` (and, optionally,
the SF Symbols app's metadata) that you supply from your own Mac.

## Install

```sh
npm install @opensymbols/decode
```

ESM only: use `import`. The decoder works on bytes (`Uint8Array`) and uses no Node API, so you
read the files yourself.

## Use

```ts
import { readFileSync } from "node:fs";
import { AssetCatalog } from "@opensymbols/decode";

const catalog = AssetCatalog.open(readFileSync("/path/to/catalog-root/public/Assets.car"));
```

Most people never import it: `npx @opensymbols/cli generate --catalog DIR --out ./my-icons` runs the
whole pipeline. The catalog layout and the decoder's checks (`opensymbols gate`) are described in
the README at the root of the OpenSymbols repository.

## License

MIT. The symbols themselves are Apple's and remain under Apple's license.
