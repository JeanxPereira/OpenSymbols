import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Catalog } from "@opensymbols/decode";
import { CatalogNotFoundError, openCatalogDir } from "./catalog-dir.js";
import { dumpAllTo, dumpRendition } from "./dump.js";
import { describeError, UsageError } from "./errors.js";
import { groupFailures, runGate } from "./gate.js";
import { generate } from "./generate/index.js";

const USAGE = `Usage: opensymbols <command> [options]

Commands:
  dump NAME [--master 1|4|9]      print the canonical dump of one symbol
  dump --all --out FILE           write the dump of every rendition to FILE
  gate                            decode every rendition and check master compatibility
  generate --out DIR [--name PKG] [--masters all|regular]
                                  write an installable icon package to DIR

Options:
  --catalog DIR                   catalog root (else $SF_CATALOG_DIR)`;

export interface Io {
  out(text: string): void;
  err(text: string): void;
}
export type Env = Record<string, string | undefined>;


function openCatalog(dir: string | undefined, env: Env): Catalog {
  const root = dir ?? env.SF_CATALOG_DIR;
  if (root === undefined || root === "") {
    throw new UsageError("no catalog: pass --catalog DIR or set SF_CATALOG_DIR");
  }
  return openCatalogDir(root);
}

/** gate and dump still work without a readable CARHEADER (Docs/format/01 §3.1); they say so. */
function noteHeader(catalog: Catalog, io: Io): void {
  if (catalog.headerNote !== undefined) io.err(`note: CARHEADER not read: ${catalog.headerNote}\n`);
}

function main(argv: string[], env: Env, io: Io): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    io.out(USAGE + "\n");
    return command === undefined ? 2 : 0;
  }
  if (command !== "dump" && command !== "gate" && command !== "generate") throw new UsageError(`unknown command "${command}"`);

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        catalog: { type: "string" },
        all: { type: "boolean" },
        out: { type: "string" },
        master: { type: "string" },
        name: { type: "string" },
        masters: { type: "string" },
      },
    });
  } catch (e) {
    // An unknown flag or a missing option value is a usage error (exit 2).
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values, positionals } = parsed;

  if (command === "generate") {
    // An object, not a string list: check-pack rejects the quoted word "masters" in a tarball.
    const allowed = { catalog: true, out: true, name: true, masters: true };
    for (const flag of Object.keys(values)) {
      if (!Object.hasOwn(allowed, flag)) throw new UsageError(`--${flag} does not apply to generate`);
    }
    if (positionals.length > 0) throw new UsageError(`generate takes no positional arguments: ${positionals.join(" ")}`);
    if (values.out === undefined || values.out === "") throw new UsageError("generate needs --out DIR");
    const masters = values.masters ?? "all";
    if (masters !== "all" && masters !== "regular") throw new UsageError("--masters must be all or regular");
    const packageName = values.name ?? "opensymbols-local";
    if (packageName === "") throw new UsageError("--name must not be empty");
    const catalog = openCatalog(values.catalog, env);
    return generate(catalog, { out: values.out, packageName, masters }, io);
  }

  if (command === "gate") {
    const catalog = openCatalog(values.catalog, env);
    noteHeader(catalog, io);
    const r = runGate(catalog);
    for (const g of groupFailures(r.failures)) {
      const more = g.distinctNames > g.names.length ? `, +${g.distinctNames - g.names.length} more` : "";
      io.err(`FAIL ${g.count}x ${g.error} [${g.names.join(", ")}${more}]\n`);
    }
    for (const m of r.incompatibleMasters) io.err(`INCOMPATIBLE ${m.name}: ${m.reason}\n`);
    if (r.skipped > 0) {
      for (const s of r.skipRecords) io.err(`SKIPPED ${s.tree}[${s.index}]: ${s.reason}\n`);
      if (r.skipRecords.length < r.skipped) {
        io.err(`SKIPPED (first ${r.skipRecords.length} of ${r.skipped} listed)\n`);
      }
    }
    if (r.metricsMissing > 0) {
      for (const n of r.metricsNotes) io.err(`note: no metrics ${n.tree}[${n.index}]: ${n.reason}\n`);
      io.err(`note: metricsMissing=${r.metricsMissing} (renditions kept without glyph metrics)\n`);
    }
    io.err(`note: localized=${r.localized} (localized facets are not master-checked)\n`);
    io.out(
      `documents=${r.documents} failures=${r.failures.length} incompatible=${r.incompatibleMasters.length} skipped=${r.skipped}
`,
    );
    return r.failures.length === 0 && r.incompatibleMasters.length === 0 && r.skipped === 0 ? 0 : 1;
  }

  if (values.all === true) {
    if (values.out === undefined) throw new UsageError("dump --all needs --out FILE");
    const catalog = openCatalog(values.catalog, env);
    noteHeader(catalog, io);
    writeDumpAll(catalog, values.out);
    return 0;
  }

  const name = positionals[0];
  if (name === undefined) throw new UsageError("dump needs NAME or --all");
  const master = values.master === undefined ? 4 : Number(values.master);
  if (master !== 1 && master !== 4 && master !== 9) throw new UsageError("--master must be 1, 4 or 9");
  const catalog = openCatalog(values.catalog, env);
  noteHeader(catalog, io);
  const entry = catalog.resolve(name);
  if (entry === undefined) throw new UsageError(`no symbol named "${name}"`);
  // GlyphWeight is rendition key token 26.
  let found = false;
  for (const d of catalog.documents()) {
    if (d.name !== entry.name || d.key[26] !== master) continue;
    io.out(dumpRendition(catalog, d.name, d.key, d.bytes));
    found = true;
  }
  if (!found) throw new UsageError(`symbol "${entry.name}" has no rendition for master ${master}`);
  return 0;
}

/** Streams the dump to `FILE.tmp`, part by part, and renames it to `FILE` only on success. */
function writeDumpAll(catalog: Catalog, file: string): void {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    dumpAllTo(catalog, (part) => {
      writeSync(fd, part);
    });
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  renameSync(tmp, file);
}

/** Runs one CLI invocation and returns the exit code; all output goes through `io`. */
export function run(argv: string[], env: Env, io: Io): number {
  try {
    return main(argv, env, io);
  } catch (e) {
    io.err(`opensymbols: ${describeError(e)}\n`);
    return e instanceof UsageError || e instanceof CatalogNotFoundError ? 2 : 1;
  }
}
