// The demo's `chunks/<n>.json`, built on request from a generated package's symbol modules: the
// package ships no chunks (each would copy its modules' JSON). Node built-ins only, so the demo's
// dev server (apps/demo/vite.config.ts) uses it too.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { moduleJson } from "../generate/module-source.js";

/** A component name as `generate` writes it; anything else in index.json is not a module file. */
const COMPONENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `chunks/<n>.json` request paths (relative to the package root). */
export const CHUNK_PATH = /^\/?chunks\/(0|[1-9]\d{0,8})\.json$/;

export class ChunkError extends Error {}

/**
 * Builds `chunks/<n>.json`: the JSON array of the symbol data of every `index.json` symbol whose
 * `chunk` is n, in index order, read from `symbols/<component>.js`. Built chunks are kept until
 * index.json changes (a new generation), so each is read from disk once.
 */
export class ChunkBuilder {
  readonly #dir: string;
  #stamp = "";
  #members = new Map<number, string[]>();
  readonly #built = new Map<number, string>();

  constructor(packageDir: string) {
    this.#dir = packageDir;
  }

  /**
   * The text of chunk `n`, or undefined when index.json has no symbol in it. Throws a ChunkError
   * when index.json or a module cannot be read or is not what `generate` writes.
   */
  chunk(n: number): string | undefined {
    this.#refresh();
    const hit = this.#built.get(n);
    if (hit !== undefined) return hit;
    const members = this.#members.get(n);
    if (members === undefined) return undefined;
    const parts = members.map((component) => {
      const file = join(this.#dir, "symbols", `${component}.js`);
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch (e) {
        throw new ChunkError(`cannot read ${file}: ${(e as Error).message}`);
      }
      const json = moduleJson(source);
      if (json === undefined) throw new ChunkError(`${file} is not a symbol module written by opensymbols generate`);
      return json;
    });
    const text = `[${parts.join(",")}]\n`;
    this.#built.set(n, text);
    return text;
  }

  /** Re-reads index.json when it changed since the last request, dropping the chunks built from the old one. */
  #refresh(): void {
    const file = join(this.#dir, "index.json");
    let stamp: string;
    try {
      const st = statSync(file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch (e) {
      throw new ChunkError(`cannot read ${file}: ${(e as Error).message}`);
    }
    if (stamp === this.#stamp) return;
    let index: unknown;
    try {
      index = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new ChunkError(`cannot read ${file}: ${(e as Error).message}`);
    }
    const symbols = (index as { symbols?: unknown } | null)?.symbols;
    if (!Array.isArray(symbols)) throw new ChunkError(`${file} has no symbols list`);
    const members = new Map<number, string[]>();
    for (const s of symbols as Array<{ component?: unknown; chunk?: unknown }>) {
      if (typeof s?.component !== "string" || !COMPONENT.test(s.component) || !Number.isInteger(s.chunk)) {
        throw new ChunkError(`${file} has a symbol without a valid component and chunk`);
      }
      const n = s.chunk as number;
      const list = members.get(n);
      if (list === undefined) members.set(n, [s.component]);
      else list.push(s.component);
    }
    this.#members = members;
    this.#built.clear();
    this.#stamp = stamp;
  }
}
