// The text of a generated symbol module: a fixed prefix, the symbol's format 2 JSON, a fixed
// suffix. No imports, so the demo's dev server (apps/demo/vite.config.ts) can read it too.

// "use client": the module calls createIcon at load, which a Server Component module cannot do.
// `/*#__PURE__*/`: the call has no side effects, so a bundler drops a module nobody imports.
export const MODULE_PREFIX = '"use client";\nimport { createIcon } from "@opensymbols/react";\nexport default /*#__PURE__*/createIcon(';
export const MODULE_SUFFIX = ");\n";

/** `symbols/<Component>.js` for a symbol's serialized `SymbolWire`. */
export function moduleSource(json: string): string {
  return MODULE_PREFIX + json + MODULE_SUFFIX;
}

/** The JSON a module written by `moduleSource` carries, or undefined when `source` is not one. */
export function moduleJson(source: string): string | undefined {
  // A file saved on Windows may have gained CRLF line ends.
  const text = source.replace(/\r\n/g, "\n");
  if (!text.startsWith(MODULE_PREFIX) || !text.endsWith(MODULE_SUFFIX)) return undefined;
  return text.slice(MODULE_PREFIX.length, text.length - MODULE_SUFFIX.length);
}
