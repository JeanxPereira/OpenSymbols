# @opensymbols/animate

Symbol effects for OpenSymbols icons: bounce, pulse, wiggle, appear, replace and the other SF
Symbols effects, played on the icons `opensymbols generate` builds.

No Apple data ships in this package. The icons come from a package you generate from your own
copy of the SF Symbols catalog (`CoreGlyphs.bundle`) with the `opensymbols` CLI.

## Install

```sh
npm install @opensymbols/animate @opensymbols/react react react-dom
```

ESM only: use `import`. `@opensymbols/react` and `react` are needed only for the `/react` entry.

## Use

Import the React entry once in client code, before the animated icons mount, then give icons an
effect:

```tsx
import "@opensymbols/animate/react";
import { Bell } from "opensymbols";

<Bell effect={{ kind: "bounce", direction: "down" }} trigger={count} />
```

The import installs the effects driver into `@opensymbols/react`; it is marked `"use client"`.
The engine (`@opensymbols/animate`, without `/react`) has no React and can be imported anywhere.
The effects, their options and `<Replace>` are described in the README at the root of the
OpenSymbols repository.

## License

MIT.
