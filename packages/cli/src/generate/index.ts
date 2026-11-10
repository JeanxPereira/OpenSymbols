// `opensymbols generate`: the user's catalog -> an installable icon package.
import type { RenderMode } from "@opensymbols/core";
import { DecodeError, type Catalog, type SymbolEntry } from "@opensymbols/decode";
import { describeError, EncodeError, UsageError } from "../errors.js";
import { encodeSymbol, type Palette } from "./encode.js";
import { fingerprint, REFERENCE_BUILD } from "./fingerprint.js";
import { assemblePackage, symbolFacts, type AssembleSymbol } from "./assemble.js";
import { buildPalette } from "./stand-in-palette.js";
import { checkOutDir } from "./write.js";

export type { IndexSymbol } from "./assemble.js";

export interface GenerateOptions {
  out: string;
  /** package.json `name`. */
  packageName: string;
  masters: "all" | "regular";
}

/** More than this share of skipped symbols fails the run (exit 1, after writing). */
const MAX_SKIPPED_SHARE = 0.01;
/** Symbol names printed per grouped warning. */
const NAMES_PER_GROUP = 5;

/** The palette `generate` encodes with; a malformed app/ file is a usage error naming it. */
function palette(catalog: Catalog): Palette {
  try {
    return buildPalette(catalog.appMetadata?.palette);
  } catch (e) {
    if (e instanceof DecodeError) {
      throw new UsageError(`cannot read the SF Symbols app files in app/: ${e.message}`);
    }
    throw e;
  }
}

/** A note's text without its leading `symbol "name"` (and an optional colon). */
const withoutSymbol = (text: string): string => text.replace(/^symbol "[^"]*":? */, "");

/**
 * What a skip reason is grouped under (the decoder stage, or the encode reason's first clause)
 * and what is left to say per symbol once the group is printed ("" when nothing is).
 */
function skipGroup(e: unknown): { group: string; detail: string } {
  if (e instanceof DecodeError) return { group: `decode error in ${e.where}`, detail: withoutSymbol(e.message) };
  const text = withoutSymbol(e instanceof Error ? e.message : String(e));
  const variant = /^variant \w+: /.exec(text)?.[0] ?? "";
  const rest = text.slice(variant.length);
  const colon = rest.indexOf(": ");
  if (colon < 0) return { group: rest, detail: variant.replace(/: $/, "") };
  return { group: rest.slice(0, colon), detail: variant + rest.slice(colon + 2) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Generates the package into `opts.out` and reports on `io.err`; returns the exit code. */
export function generate(catalog: Catalog, opts: GenerateOptions, io: { err(text: string): void }): number {
  const pal = palette(catalog);
  checkOutDir(opts.out);
  const { note: headerNote, ...build } = fingerprint(catalog);

  const encoded: Array<{ entry: SymbolEntry; json: string; facts: AssembleSymbol["facts"] }> = [];
  const skipped: Array<{ name: string; reason: string; group: string; detail: string }> = [];
  const localized: Array<{ name: string; base: string }> = [];
  // Warning text (symbol name stripped) -> the symbols it was raised for.
  const warnings = new Map<string, string[]>();
  for (const entry of catalog.symbols()) {
    if (entry.localizedVariantOf !== undefined) {
      localized.push({ name: entry.name, base: entry.localizedVariantOf });
      continue;
    }
    // Docs/format/01 §3.10: a facet of pixels only is not a symbol; nothing to generate.
    if (!entry.drawable) continue;
    const notes: string[] = [];
    try {
      const data = encodeSymbol(catalog, entry, {
        masters: opts.masters,
        palette: pal,
        validated: build.validated,
        warnings: notes,
      });
      encoded.push({ entry, json: JSON.stringify(data), facts: symbolFacts(data) });
    } catch (e) {
      // One bad symbol must not abort the run: skip it, name it and say why. Anything else is a
      // bug, and stops the run naming the symbol it was raised on.
      if (!(e instanceof EncodeError || e instanceof DecodeError)) {
        throw new Error(`symbol "${entry.name}": unexpected error: ${describeError(e)}`, { cause: e });
      }
      skipped.push({ name: entry.name, reason: describeError(e), ...skipGroup(e) });
      continue;
    }
    for (const n of notes) {
      const key = withoutSymbol(n);
      const names = warnings.get(key);
      if (names === undefined) warnings.set(key, [entry.name]);
      else if (!names.includes(entry.name)) names.push(entry.name);
    }
  }

  // Names are assigned over the generated symbols only; a collision is fatal before writing.
  const { aliasExports, reports } = assemblePackage({
    out: opts.out,
    packageName: opts.packageName,
    build,
    palette: pal.source,
    symbols: encoded.map(({ entry, json, facts }) => ({
      name: entry.name,
      aliases: entry.aliases,
      categories: entry.categories,
      searchTerms: entry.searchTerms,
      year: entry.year ?? null,
      json,
      facts,
    })),
    categories: catalog.categories,
    categoryLabels: catalog.appMetadata?.categoryLabels,
    skipped,
    localized,
  });

  // The report.
  const candidates = encoded.length + skipped.length;
  io.err(
    `generated ${plural(encoded.length, "symbol")} into ${opts.out} ` +
      `(palette: ${pal.source}, masters: ${opts.masters}, alias exports: ${aliasExports.size})\n`,
  );
  if (skipped.length > 0) {
    const share = ((skipped.length / candidates) * 100).toFixed(1);
    io.err(`skipped ${plural(skipped.length, "symbol")} (${skipped.length} of ${candidates}, ${share}%):\n`);
    const groups = new Map<string, typeof skipped>();
    for (const s of skipped) {
      const g = groups.get(s.group);
      if (g === undefined) groups.set(s.group, [s]);
      else g.push(s);
    }
    for (const [group, list] of groups) {
      io.err(`  ${group} (${list.length}):\n`);
      for (const s of list) io.err(s.detail === "" ? `    ${s.name}\n` : `    ${s.name}: ${s.detail}\n`);
    }
  }
  if (localized.length > 0) {
    io.err(`localized: ${plural(localized.length, "facet")} not generated (listed in index.json "localized")\n`);
  }
  for (const r of reports) io.err(`note: ${r}\n`);
  for (const [text, list] of warnings) {
    const more = list.length > NAMES_PER_GROUP ? `, +${list.length - NAMES_PER_GROUP} more` : "";
    io.err(`warning: ${text} [${list.slice(0, NAMES_PER_GROUP).join(", ")}${more}]\n`);
  }
  if (pal.source === "stand-in") {
    io.err(`note: palette "stand-in": no app/colors-26.csv, named colours use approximations of Apple's\n`);
  }
  io.err(
    `build: coreuiVersion=${build.coreuiVersion} renditionCount=${build.renditionCount} ` +
      `facetCount=${build.facetCount} validated=${build.validated}\n`,
  );
  if (headerNote !== undefined) {
    io.err(`warning: the catalog's CARHEADER could not be read (${headerNote}); the build cannot be fingerprinted\n`);
  }
  if (!build.validated) {
    const ref = REFERENCE_BUILD;
    io.err(
      `warning: build not validated: this catalog is not the reference build (coreuiVersion=${ref.coreuiVersion} ` +
        `renditionCount=${ref.renditionCount} facetCount=${ref.facetCount}); the output was not checked against it\n`,
    );
  }
  if (skipped.length > candidates * MAX_SKIPPED_SHARE) {
    io.err(
      `opensymbols: ${skipped.length} of ${candidates} symbols skipped, more than 1%: ` +
        `likely a systematic problem; the package was written but this run fails\n`,
    );
    return 1;
  }
  return 0;
}
