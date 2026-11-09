import { FORMAT_VERSION, type RenderMode } from "@opensymbols/core";

/** One `index.json` symbol (mirrors packages/cli/src/generate/assemble.ts). */
export interface DemoSymbol {
  name: string;
  component: string;
  aliases: string[];
  categories: string[];
  searchTerms: string[];
  year: string | null;
  modes: RenderMode[];
  variableValue: boolean;
  approximate: string[];
  /** Chunk number; chunk `n` holds up to 200 symbols, in index order. */
  chunk: number;
}

export interface DemoCategory {
  key: string;
  label: string;
  icon?: string;
  count: number;
}

/** The `index.json` of a generated package. */
export interface DemoIndex {
  formatVersion: number;
  package: { name: string };
  build: { coreuiVersion?: string; renditionCount?: number; facetCount?: number; validated?: boolean; [k: string]: unknown };
  palette: "apple" | "stand-in";
  categories: DemoCategory[];
  symbols: DemoSymbol[];
  localized: Array<{ name: string; base: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

/** `base` ("/pkg", with or without a trailing slash) + a relative path. */
export function packageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path}`;
}

export async function loadIndex(base: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<DemoIndex> {
  const url = packageUrl(base, "index.json");
  const res = await fetchFn(url);
  if (res.status !== 200) throw new Error(`cannot load ${url}: HTTP ${res.status}`);
  const index = (await res.json()) as DemoIndex;
  if (index.formatVersion > FORMAT_VERSION) {
    throw new Error(
      `the package (format ${index.formatVersion}) is newer than the demo (format ${FORMAT_VERSION}); update the demo`,
    );
  }
  return index;
}
