// Copies the built demo app (apps/demo/dist) into dist/demo so `opensymbols demo` can serve it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..", "..", "..", "apps", "demo", "dist");
const dest = join(import.meta.dirname, "..", "dist", "demo");
if (!existsSync(join(src, "index.html"))) {
  console.error(`copy-demo: ${src} is not built; build apps/demo first (pnpm build at the repo root)`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
