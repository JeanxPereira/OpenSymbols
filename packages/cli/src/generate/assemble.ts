// Internal, not public API: the CLI ships it only so scripts/synthetic-package.mjs can reuse the writer.
// From encoded symbols to a package on disk: names, index.json and the files. Shared by
// `generate` and scripts/synthetic-package.mjs (which imports the built dist/generate/assemble.js).
import { FORMAT_VERSION, type RenderMode, type SymbolData } from "@opensymbols/core";
import { describeError } from "../errors.js";
import { assignNames } from "./names.js";
import { CHUNK_SIZE, writePackage } from "./write.js";

export { componentName } from "./names.js";

/** One `index.json` symbol entry. */
export interface IndexSymbol {
  name: string;
  component: string;
  aliases: string[];
  categories: string[];
  searchTerms: string[];
  year: string | null;
  modes: RenderMode[];
  /** Any layer of the default variant has a variable-value threshold. */
  variableValue: boolean;
  /** Why a render is approximate whatever its options: "palette" (stand-in colours), "build". */
  approximate: string[];
  chunk: number;
}

/** One `index.json` category. */
export interface IndexCategory {
  key: string;
  label: string;
  icon?: string;
  /** Generated symbols in it. */
  count: number;
}

/** What `index.json` says about a symbol that follows from its `SymbolData`. */
export type SymbolFacts = Pick<IndexSymbol, "modes" | "variableValue" | "approximate">;

export function symbolFacts(data: SymbolData): SymbolFacts {
  const variant = data.variants[data.defaultVariant];
  const approximate: string[] = [];
  if (data.palette === "stand-in" && data.modes.includes("multicolor")) approximate.push("palette");
  if (data.build?.validated === false) approximate.push("build");
  return {
    modes: data.modes,
    variableValue: variant?.layers.some((l) => l.variableThreshold !== undefined) ?? false,
    approximate,
  };
}

export interface AssembleSymbol {
  name: string;
  aliases: readonly string[];
  categories: readonly string[];
  searchTerms: readonly string[];
  year: string | null;
  /** The symbol's `SymbolData`, serialized. */
  json: string;
  facts: SymbolFacts;
}

export interface AssembleInput {
  out: string;
  /** package.json `name`. */
  packageName: string;
  /** index.json `build`, as is. */
  build: object;
  palette: "apple" | "stand-in";
  symbols: readonly AssembleSymbol[];
  /** The bundle's categories, in order; an empty `label` means it has none. */
  categories: ReadonlyArray<{ key: string; icon?: string; label?: string }>;
  /** The app's labels by category key; they win over the bundle's. */
  categoryLabels?: ReadonlyMap<string, string> | undefined;
  skipped?: ReadonlyArray<{ name: string; reason: string }>;
  localized?: ReadonlyArray<{ name: string; base: string }>;
}

export interface Assembled {
  /** alias component name -> the component it re-exports */
  aliasExports: Map<string, string>;
  /** Notes about aliases that were skipped. */
  reports: string[];
}

/**
 * Names the components (throws, nothing written, on a collision), then writes the package.
 * Components are named over `symbols` only, in order; `chunk` follows that order.
 */
export function assemblePackage(input: AssembleInput): Assembled {
  const aliases = new Map<string, string>();
  for (const s of input.symbols) for (const a of s.aliases) aliases.set(a, s.name);
  let named;
  try {
    named = assignNames(input.symbols.map((s) => s.name), aliases);
  } catch (e) {
    throw new Error(`cannot name the components, nothing written: ${describeError(e)}`);
  }
  const { names, aliasExports, reports } = named;
  // Two modules whose names differ only in case are one file on Windows and macOS. (Alias
  // exports are only names in index.js, not files.)
  const byLower = new Map<string, string>();
  for (const component of names.values()) {
    const other = byLower.get(component.toLowerCase());
    if (other !== undefined) {
      throw new Error(
        `cannot name the components, nothing written: "${other}" and "${component}" differ only in case`,
      );
    }
    byLower.set(component.toLowerCase(), component);
  }

  const symbols: IndexSymbol[] = input.symbols.map((s, i) => ({
    name: s.name,
    component: names.get(s.name) as string,
    aliases: [...s.aliases],
    categories: [...s.categories],
    searchTerms: [...s.searchTerms],
    year: s.year,
    modes: s.facts.modes,
    variableValue: s.facts.variableValue,
    approximate: s.facts.approximate,
    chunk: Math.floor(i / CHUNK_SIZE),
  }));

  const counts = new Map<string, number>();
  for (const s of symbols) for (const c of new Set(s.categories)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const categories: IndexCategory[] = [];
  for (const c of input.categories) {
    const count = counts.get(c.key) ?? 0;
    if (count === 0) continue;
    const label = input.categoryLabels?.get(c.key) || c.label || c.key;
    categories.push({ key: c.key, label, ...(c.icon ? { icon: c.icon } : {}), count });
  }

  const index = {
    formatVersion: FORMAT_VERSION,
    package: { name: input.packageName },
    build: input.build,
    palette: input.palette,
    categories,
    symbols,
    skipped: (input.skipped ?? []).map(({ name, reason }) => ({ name, reason })),
    localized: input.localized ?? [],
  };
  writePackage(input.out, {
    packageName: input.packageName,
    index,
    symbols: input.symbols.map((s) => ({ component: names.get(s.name) as string, json: s.json })),
    aliasExports: [...aliasExports].map(([alias, modern]) => [alias, names.get(modern) as string] as const),
  });
  return { aliasExports, reports };
}
