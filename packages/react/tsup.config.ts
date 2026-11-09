import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react"],
  // Lets the components be imported from React Server Components trees.
  banner: { js: '"use client";' },
});
