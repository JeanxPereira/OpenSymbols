import type { Catalog } from "@opensymbols/decode";

export interface BuildFingerprint {
  /** Null when CARHEADER could not be read (`note` says why). */
  coreuiVersion: number | null;
  renditionCount: number | null;
  /** Public facets, localized ones included. */
  facetCount: number;
  /** True only when the catalog is the build the format docs and the renderer were checked against. */
  validated: boolean;
  /** Why the header is missing; not written to index.json. */
  note?: string;
}

/** The reference build: the catalog Docs/format was decoded from and the renderer checked against. */
export const REFERENCE_BUILD = { coreuiVersion: 1010, renditionCount: 157938, facetCount: 8527 } as const;

export function fingerprint(catalog: Catalog): BuildFingerprint {
  const facetCount = catalog.symbols().length;
  const header = catalog.header;
  if (header === undefined) {
    // A build without a readable header is never the reference one.
    const note = catalog.headerNote ?? "no CARHEADER";
    return { coreuiVersion: null, renditionCount: null, facetCount, validated: false, note };
  }
  const { coreuiVersion, renditionCount } = header;
  const validated =
    coreuiVersion === REFERENCE_BUILD.coreuiVersion &&
    renditionCount === REFERENCE_BUILD.renditionCount &&
    facetCount === REFERENCE_BUILD.facetCount;
  return { coreuiVersion, renditionCount, facetCount, validated };
}
