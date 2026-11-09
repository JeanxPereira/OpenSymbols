import { parseBvg, type BvgDocument } from "./bvg/document.js";
import { parseStyleBlock } from "./bvg/style.js";
import {
  AssetCatalog,
  Token,
  type Rendition,
  type RenditionKey,
  type SkipCounts,
  type SkipRecord,
} from "./car.js";
import { DecodeError } from "./errors.js";
import { buildDrawing, type Drawing } from "./drawing.js";
import { loadBundleMetadata, type BundleMetadata } from "./metadata.js";

const WHERE = "Catalog";

/** GlyphWeight masters (Docs/format/05 §4.1): 1 Ultralight, 4 Regular, 9 Black. */
export type Master = 1 | 4 | 9;

export interface SymbolEntry {
  name: string;
  identifier: number;
  aliases: string[];
  categories: string[];
  searchTerms: string[];
  year?: string;
  localizedVariantOf?: string;
  /**
   * Docs/format/05 §4.4: `direction` is the sorted Direction set only when it holds both 4
   * and 5 (a `{5}`-only facet has no variant), else `[]`; `appearance` is the sorted set when
   * it has more than one member, else `[]`.
   */
  variants: { appearance: number[]; direction: number[] };
}

export interface PickOptions {
  appearance?: number;
  direction?: number;
}

export class Catalog {
  readonly #car: AssetCatalog;
  readonly #meta: BundleMetadata;
  readonly #entries: SymbolEntry[];
  readonly #byName = new Map<string, SymbolEntry>();

  private constructor(car: AssetCatalog, meta: BundleMetadata) {
    this.#car = car;
    this.#meta = meta;

    const facets = car.facets();
    // Docs/format/05 §4.3: suffixes that mark a localized or right-to-left facet.
    const suffixes = new Set<string>(["rtl"]);
    for (const tag of car.localizations().keys()) {
      suffixes.add(tag);
      // A tag with a script subtag (zh-Hans) appears in facet names as the language alone.
      const m = /^([A-Za-z]{2,3})-(Hans|Hant)$/.exec(tag);
      if (m !== null) suffixes.add(m[1] as string);
    }
    const aliasesOf = new Map<string, string[]>();
    for (const [alias, modern] of meta.aliasToModern) {
      const list = aliasesOf.get(modern);
      if (list === undefined) aliasesOf.set(modern, [alias]);
      else list.push(alias);
    }

    this.#entries = [];
    for (const [name, identifier] of facets) {
      const directions = new Set<number>();
      const appearances = new Set<number>();
      for (const r of car.renditions(identifier)) {
        if (r.payload === null) continue;
        directions.add(r.key[Token.Direction] ?? 0);
        appearances.add(r.key[Token.Appearance] ?? 0);
      }
      const entry: SymbolEntry = {
        name,
        identifier,
        aliases: aliasesOf.get(name) ?? [],
        categories: meta.symbolCategories.get(name) ?? [],
        searchTerms: meta.searchTerms.get(name) ?? [],
        variants: {
          appearance: appearances.size > 1 ? sorted(appearances) : [],
          direction: directions.has(4) && directions.has(5) ? sorted(directions) : [],
        },
      };
      const year = meta.availability.get(name);
      if (year !== undefined) entry.year = year;
      const dot = name.lastIndexOf(".");
      if (dot > 0 && suffixes.has(name.slice(dot + 1)) && facets.has(name.slice(0, dot))) {
        entry.localizedVariantOf = name.slice(0, dot);
      }
      this.#entries.push(entry);
      this.#byName.set(name, entry);
    }
  }

  /**
   * `appFiles` is accepted for the SF Symbols app's files (Docs/format/05 §3) but nothing in
   * `SymbolEntry` draws on them yet, so they are not read.
   */
  static open(input: {
    car: Uint8Array;
    bundleFiles: Map<string, Uint8Array>;
    appFiles?: Map<string, Uint8Array>;
  }): Catalog {
    return new Catalog(AssetCatalog.open(input.car), loadBundleMetadata(input.bundleFiles));
  }

  /** Rendition key tokens in KEYFORMAT order (Docs/format/01 §3.3). */
  get keyFormat(): readonly number[] {
    return [...this.#car.keyFormat];
  }

  /** Records the container reader skipped as malformed (Docs/format/01 §6); a copy. */
  get skipped(): SkipCounts {
    return { ...this.#car.skipped };
  }

  /** The first skipped records with their tree, index and reason (Docs/format/01 §6); a copy. */
  get skipRecords(): SkipRecord[] {
    return this.#car.skipRecords;
  }

  symbols(): SymbolEntry[] {
    return [...this.#entries];
  }

  /** Docs/format/05 §4.2: the facet itself, else the modern name an alias points to. */
  resolve(name: string): SymbolEntry | undefined {
    const direct = this.#byName.get(name);
    if (direct !== undefined) return direct;
    const modern = this.#meta.aliasToModern.get(name);
    return modern === undefined ? undefined : this.#byName.get(modern);
  }

  document(name: string, master: Master, opts: PickOptions = {}): BvgDocument {
    return parseBvg(this.#pick(name, master, opts));
  }

  drawing(name: string, master: Master, opts: PickOptions = {}): Drawing {
    const doc = this.document(name, master, opts);
    return buildDrawing(doc, parseStyleBlock(doc));
  }

  /**
   * Every vector rendition in the RENDITIONS tree (Docs/format/01 §3.7), named by its facet
   * when one carries the identifier, else by the csiheader name.
   */
  *documents(): Iterable<{ name: string; key: RenditionKey; bytes: Uint8Array }> {
    const names = new Map<number, string>();
    for (const e of this.#entries) if (!names.has(e.identifier)) names.set(e.identifier, e.name);
    for (const r of this.#car.allRenditions()) {
      if (r.payload === null) continue;
      yield {
        name: names.get(r.key[Token.Identifier] as number) ?? r.name,
        key: r.key,
        bytes: r.payload,
      };
    }
  }

  /**
   * Docs/format/05 §4.4: filter on (Identifier, GlyphWeight, Localization 0) and any fixed axis,
   * take the lowest pair. Two renditions with the same full tuple are an error, not a choice.
   */
  #pick(name: string, master: Master, opts: PickOptions): Uint8Array {
    const entry = this.resolve(name);
    if (entry === undefined) throw new DecodeError(WHERE, `no symbol named "${name}"`);
    let best: Rendition | undefined;
    let tie = false;
    for (const r of this.#car.renditions(entry.identifier)) {
      if (r.payload === null) continue;
      if (r.key[Token.GlyphWeight] !== master) continue;
      if ((r.key[Token.Localization] ?? 0) !== 0) continue;
      const direction = r.key[Token.Direction] ?? 0;
      const appearance = r.key[Token.Appearance] ?? 0;
      if (opts.direction !== undefined && direction !== opts.direction) continue;
      if (opts.appearance !== undefined && appearance !== opts.appearance) continue;
      if (best === undefined || less(direction, appearance, best)) {
        best = r;
        tie = false;
      } else if (!less(...pair(best), r)) {
        tie = true; // neither is lower: the same (Direction, Appearance)
      }
    }
    if (best !== undefined && tie) {
      const [d, a] = pair(best);
      throw new DecodeError(
        WHERE,
        `symbol "${entry.name}": two vector renditions share identifier ${entry.identifier}, weight ${master}, localization 0, direction ${d}, appearance ${a} (05 §4.4)`,
      );
    }
    if (best === undefined) {
      const fixed =
        (opts.direction === undefined ? "" : `, direction ${opts.direction}`) +
        (opts.appearance === undefined ? "" : `, appearance ${opts.appearance}`);
      throw new DecodeError(
        WHERE,
        `symbol "${entry.name}" (identifier ${entry.identifier}) has no vector rendition for weight ${master}, localization 0${fixed}`,
      );
    }
    return best.payload as Uint8Array;
  }
}

function pair(r: Rendition): [number, number] {
  return [r.key[Token.Direction] ?? 0, r.key[Token.Appearance] ?? 0];
}

function less(direction: number, appearance: number, than: Rendition): boolean {
  const d = than.key[Token.Direction] ?? 0;
  return direction < d || (direction === d && appearance < (than.key[Token.Appearance] ?? 0));
}

function sorted(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b);
}
