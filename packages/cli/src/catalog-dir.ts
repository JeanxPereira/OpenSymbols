import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Catalog } from "@opensymbols/decode";

function readDir(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile()) out.set(f.name, new Uint8Array(readFileSync(join(dir, f.name))));
  }
  return out;
}

export class CatalogNotFoundError extends Error {}

/** What a catalog root holds; quoted by the not-found error and the README. */
export const CATALOG_LAYOUT =
  "a catalog root holds public/ (the contents of CoreGlyphs.bundle/Contents/Resources, " +
  "flattened: Assets.car and the metadata plists) and, optionally, app/ (the SF Symbols " +
  "app's Resources/Metadata files and colors-26.csv)";

/** Opens the catalog under `root`: `public/Assets.car`, every file in `public/`, every file in `app/`. */
export function openCatalogDir(root: string): Catalog {
  const carPath = join(root, "public", "Assets.car");
  if (!existsSync(carPath)) {
    throw new CatalogNotFoundError(`catalog not found: missing ${carPath}; ${CATALOG_LAYOUT}`);
  }
  return Catalog.open({
    car: new Uint8Array(readFileSync(carPath)),
    bundleFiles: readDir(join(root, "public")),
    appFiles: readDir(join(root, "app")),
  });
}
