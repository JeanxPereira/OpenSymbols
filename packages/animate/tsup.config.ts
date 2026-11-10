import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

const REACT_ENTRY = "dist/react/index.js";

export default defineConfig({
  // One build, so the React entry shares the engine's chunk (one plan registry, one cache) rather
  // than carrying a copy of it.
  entry: { index: "src/index.ts", "react/index": "src/react/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: true,
  external: ["react", "@opensymbols/react", "@opensymbols/core"],
  // Only the React entry is a client module: the engine stays importable from server code.
  async onSuccess() {
    const js = readFileSync(REACT_ENTRY, "utf8");
    if (!js.startsWith('"use client"')) writeFileSync(REACT_ENTRY, `"use client";\n${js}`);
  },
});
