// Writes a generated icon package to disk (the layout is in the README, "Generate your package").
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";
import { moduleSource } from "./module-source.js";

/**
 * Symbols per demo chunk: `index.json` gives each symbol its `chunk`, and the demo server builds
 * `chunks/<n>.json` from those modules on request. The package itself holds no chunks.
 */
export const CHUNK_SIZE = 200;

/** Where a run stages its output inside the out dir before moving it into place. */
const STAGING = ".opensymbols-staging";
/** The files a generation owns, besides `symbols/`; `index.json` is moved last. */
const FILES = ["index.js", "index.d.ts", "symbol.d.ts", "package.json", "index.json"] as const;
const DIRS = ["symbols"] as const;
/** What earlier generations wrote and this one no longer does: removed when replacing their output. */
const FORMER = ["chunks"] as const;

export interface PackageContents {
  /** package.json `name`. */
  packageName: string;
  /** index.json, written as is. */
  index: unknown;
  /** One per generated symbol, in index order; `json` is the symbol's `SymbolData` serialized. */
  symbols: ReadonlyArray<{ component: string; json: string }>;
  /** Alias component -> the component it re-exports. */
  aliasExports: ReadonlyArray<readonly [alias: string, component: string]>;
}

/** Whether `index` looks like a previous generation's index.json. */
function isGenerationIndex(index: unknown): boolean {
  if (typeof index !== "object" || index === null) return false;
  const i = index as { formatVersion?: unknown; build?: unknown; symbols?: unknown };
  return typeof i.formatVersion === "number" && typeof i.build === "object" && i.build !== null && Array.isArray(i.symbols);
}

/**
 * Throws a UsageError unless `out` can be written: absent, empty, holding a previous generation
 * (an `index.json` with `formatVersion`, `build` and a `symbols` array), or the remains of a run
 * that stopped before writing index.json (only entries a generation owns, among them the staging
 * dir or `symbols/`). A user's directory is never clobbered.
 */
export function checkOutDir(out: string): void {
  if (!existsSync(out)) return;
  if (!statSync(out).isDirectory()) throw new UsageError(`--out ${out} exists and is not a directory`);
  const entries = readdirSync(out);
  if (entries.length === 0) return;
  const refuse = (why: string): never => {
    throw new UsageError(
      `refusing to write into ${out}: it is not empty and ${why}; pass an empty or new directory, or the output of a previous "opensymbols generate"`,
    );
  };
  const indexFile = join(out, "index.json");
  if (!existsSync(indexFile)) {
    // A run stops between staging and moving index.json into place: the staging dir is removed
    // only after index.json is, so its remains always include it or symbols/.
    const owned = new Set<string>([STAGING, ...DIRS, ...FORMER, ...FILES]);
    const crashed = entries.every((e) => owned.has(e)) && (entries.includes(STAGING) || entries.includes("symbols"));
    if (crashed) return;
    return refuse("has no index.json from a previous generation");
  }
  let index: unknown;
  try {
    index = JSON.parse(readFileSync(indexFile, "utf8"));
  } catch {
    return refuse("its index.json is not readable JSON");
  }
  if (!isGenerationIndex(index)) refuse("its index.json is not one a generation wrote (formatVersion, build, symbols)");
}

/** The one declaration every symbol module shares, through the `exports` map's `types`. */
const DECLARATION = 'declare const C: import("@opensymbols/react").OpenSymbolIcon;\nexport default C;\n';
const reexport = (as: string, component: string) =>
  `export { default as ${as} } from "./symbols/${component}.js";`;

/**
 * Writes the package to `out` (checked again with `checkOutDir`): everything is staged in
 * `out/.opensymbols-staging`, then the previous `symbols/` is replaced (and an earlier format's
 * `chunks/` removed) and the index files renamed over the old ones, `index.json` last.
 */
export function writePackage(out: string, pkg: PackageContents): void {
  checkOutDir(out);
  const stage = join(out, STAGING);
  rmSync(stage, { recursive: true, force: true });
  for (const d of DIRS) mkdirSync(join(stage, d), { recursive: true });

  for (const { component, json } of pkg.symbols) {
    writeFileSync(join(stage, "symbols", `${component}.js`), moduleSource(json));
  }

  const names = [...pkg.symbols.map((s) => [s.component, s.component] as const), ...pkg.aliasExports];
  const barrel = names.length === 0 ? "export {};\n" : names.map(([as, c]) => reexport(as, c)).join("\n") + "\n";
  writeFileSync(join(stage, "index.js"), barrel);
  // The modules have no declaration files of their own (their types come from symbol.d.ts through
  // the exports map, which a relative import does not use): the barrel declares each name.
  const declarations =
    names.length === 0
      ? "export {};\n"
      : 'type Icon = import("@opensymbols/react").OpenSymbolIcon;\n' +
        names.map(([as]) => `export declare const ${as}: Icon;`).join("\n") +
        "\n";
  writeFileSync(join(stage, "index.d.ts"), declarations);
  writeFileSync(join(stage, "symbol.d.ts"), DECLARATION);
  const packageJson = {
    name: pkg.packageName,
    version: "0.0.0",
    private: true,
    type: "module",
    sideEffects: false,
    main: "index.js",
    types: "index.d.ts",
    // Deep imports ("my-icons/Wifi") load one module; a barrel import makes dev servers that do
    // not tree-shake (Vite's dep optimizer, Next.js without optimizePackageImports) load them all.
    exports: {
      ".": { types: "./index.d.ts", default: "./index.js" },
      "./index.json": "./index.json",
      "./symbols/*": { types: "./symbol.d.ts", default: "./symbols/*" },
      "./*": { types: "./symbol.d.ts", default: "./symbols/*.js" },
    },
    peerDependencies: { "@opensymbols/react": "*", react: ">=19" },
  };
  writeFileSync(join(stage, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  writeFileSync(join(stage, "index.json"), JSON.stringify(pkg.index) + "\n");

  for (const d of DIRS) {
    withFsRetry("remove", join(out, d), () => rmSync(join(out, d), { recursive: true, force: true }));
    withFsRetry("rename", join(stage, d), () => renameSync(join(stage, d), join(out, d)));
  }
  for (const d of FORMER) withFsRetry("remove", join(out, d), () => rmSync(join(out, d), { recursive: true, force: true }));
  for (const f of FILES) withFsRetry("rename", join(stage, f), () => renameSync(join(stage, f), join(out, f)));
  withFsRetry("remove", stage, () => rmSync(stage, { recursive: true, force: true }));
}

/** Error codes Windows gives while another process (antivirus, indexer, editor) holds a file. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
/** [INF] How long a held file is waited for; long enough for a scan, short enough to fail visibly. */
const RETRY_FOR_MS = 5000;
const FIRST_DELAY_MS = 50;
const MAX_DELAY_MS = 1000;

export interface RetryClock {
  now(): number;
  sleep(ms: number): void;
}

const realClock: RetryClock = {
  now: () => Date.now(),
  // A synchronous wait: the write is synchronous, and nothing else runs meanwhile.
  sleep: (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
};

/**
 * Runs `op` (a synchronous fs call on `path`), retrying with doubling delays for up to about
 * 5 s while it fails with EPERM, EACCES or EBUSY, which Windows reports while another process
 * holds the file. Then it throws, naming the path. Other errors are thrown at once.
 */
export function withFsRetry<T>(what: string, path: string, op: () => T, clock: RetryClock = realClock): T {
  const start = clock.now();
  let delay = FIRST_DELAY_MS;
  for (;;) {
    try {
      return op();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === undefined || !TRANSIENT.has(code)) throw e;
      const waited = clock.now() - start;
      if (waited >= RETRY_FOR_MS) {
        throw new Error(
          `cannot ${what} ${path}: ${code} for ${(waited / 1000).toFixed(1)} s; another process holds it ` +
            `(often an antivirus scan or a search indexer, or an editor or dev server watching the folder): ` +
            `close it or exclude the folder, then run generate again`,
          { cause: e },
        );
      }
      clock.sleep(Math.min(delay, RETRY_FOR_MS - waited));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}
