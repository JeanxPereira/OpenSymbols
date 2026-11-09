import { closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Catalog } from "@opensymbols/decode";
import { CatalogNotFoundError, openCatalogDir } from "./catalog-dir.js";
import { dumpAllTo, dumpRendition } from "./dump.js";
import { describeError } from "./errors.js";
import { groupFailures, runGate } from "./gate.js";

const USAGE = `Usage: opensymbols <command> [options]

Commands:
  dump NAME [--master 1|4|9]      print the canonical dump of one symbol
  dump --all --out FILE           write the dump of every rendition to FILE
  gate                            decode every rendition and check master compatibility

Options:
  --catalog DIR                   catalog root (else $SF_CATALOG_DIR)`;

export interface Io {
  out(text: string): void;
  err(text: string): void;
}
export type Env = Record<string, string | undefined>;

class UsageError extends Error {}

function openCatalog(dir: string | undefined, env: Env): Catalog {
  const root = dir ?? env.SF_CATALOG_DIR;
  if (root === undefined || root === "") {
    throw new UsageError("no catalog: pass --catalog DIR or set SF_CATALOG_DIR");
  }
  return openCatalogDir(root);
}

function main(argv: string[], env: Env, io: Io): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    io.out(USAGE + "\n");
    return command === undefined ? 2 : 0;
  }
  if (command !== "dump" && command !== "gate") throw new UsageError(`unknown command "${command}"`);

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
      },
    });
  } catch (e) {
    // An unknown flag or a missing option value is a usage error (exit 2).
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values, positionals } = parsed;

  if (command === "gate") {
    const catalog = openCatalog(values.catalog, env);
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
    writeDumpAll(catalog, values.out);
    return 0;
  }

  const name = positionals[0];
  if (name === undefined) throw new UsageError("dump needs NAME or --all");
  const master = values.master === undefined ? 4 : Number(values.master);
  if (master !== 1 && master !== 4 && master !== 9) throw new UsageError("--master must be 1, 4 or 9");
  const catalog = openCatalog(values.catalog, env);
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
