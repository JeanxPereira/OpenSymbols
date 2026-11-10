import { parseBvg, type BvgDocument } from "./bvg/document.js";
import { parseStyleBlock } from "./bvg/style.js";
import {
  AssetCatalog,
  Token,
  type CatalogHeader,
  type GlyphMetrics,
  type Rendition,
  type RenditionKey,
  type SkipCounts,
  type SkipRecord,
} from "./car.js";
import { DecodeError } from "./errors.js";
import { buildDrawing, type Drawing, type RenderingMode } from "./drawing.js";
import { loadAppMetadata, loadBundleMetadata, type AppMetadata, type BundleMetadata } from "./metadata.js";

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
  /**
   * The facet has at least one vector rendition (Docs/format/01 §3.10). A facet of pixels only,
   * such as `_gradient.highlegibility`, is in the catalog but is not a symbol to draw.
   */
  drawable: boolean;
}

/** `AppMetadata` (Docs/format/05 §3) as `Catalog` exposes it: read-only. */
export interface AppMetadataView {
  readonly categoryLabels: ReadonlyMap<string, string>;
  readonly baseSymbols: ReadonlyMap<string, readonly string[]>;
  readonly layersetAvailability: ReadonlyMap<string, readonly RenderingMode[]>;
  readonly palette?: {
    readonly light: ReadonlyMap<string, string>;
    readonly dark: ReadonlyMap<string, string>;
  };
}

export interface PickOptions {
  appearance?: number;
  direction?: number;
  /** A `LOCALIZATIONKEYS` id (token 13, Docs/format/05 §4.3); default 0, the base drawing. */
  localization?: number;
}

/** The variant axes of a set of renditions (Docs/format/05 §4.4); see `SymbolEntry.variants`. */
export interface VariantAxes {
  appearance: number[];
  direction: number[];
}

export class Catalog {
  readonly #car: AssetCatalog;
  readonly #meta: BundleMetadata;
  readonly #appFiles: Map<string, Uint8Array> | undefined;
  #app: AppMetadata | undefined;
  readonly #entries: SymbolEntry[];
  readonly #byName = new Map<string, SymbolEntry>();

  private constructor(car: AssetCatalog, meta: BundleMetadata, appFiles: Map<string, Uint8Array> | undefined) {
    this.#car = car;
    this.#meta = meta;
    this.#appFiles = appFiles;

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
      let drawable = false;
      for (const r of car.renditions(identifier)) {
        if (r.payload === null) continue;
        drawable = true;
        // Only what the pick can reach (05 §4.4): a localization's own direction is not a variant.
        if ((r.key[Token.Localization] ?? 0) !== 0) continue;
        directions.add(r.key[Token.Direction] ?? 0);
        appearances.add(r.key[Token.Appearance] ?? 0);
      }
      const entry: SymbolEntry = {
        name,
        identifier,
        aliases: aliasesOf.get(name) ?? [],
        categories: meta.symbolCategories.get(name) ?? [],
        searchTerms: meta.searchTerms.get(name) ?? [],
        variants: axes(directions, appearances),
        drawable,
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
   * `appFiles` are the SF Symbols app's files (Docs/format/05 §3). They are kept unparsed
   * here, so a malformed app file cannot break readers that never ask for it (`dump`, `gate`);
   * `appMetadata` parses them on first access.
   */
  static open(input: {
    car: Uint8Array;
    bundleFiles: Map<string, Uint8Array>;
    appFiles?: Map<string, Uint8Array>;
  }): Catalog {
    return new Catalog(AssetCatalog.open(input.car), loadBundleMetadata(input.bundleFiles), input.appFiles);
  }

  /**
   * The app's metadata (Docs/format/05 §3) when `appFiles` were given, else undefined. Parsed
   * on first access and memoised; a malformed app file throws its DecodeError here, each time.
   */
  get appMetadata(): AppMetadataView | undefined {
    if (this.#appFiles === undefined) return undefined;
    this.#app ??= loadAppMetadata(this.#appFiles);
    return this.#app;
  }

  /**
   * The bundle's categories (Docs/format/05 §2.5) in file order; `label` is "" because the
   * bundle's copy has none (the app's file carries the labels: `appMetadata.categoryLabels`).
   */
  get categories(): ReadonlyArray<{ readonly key: string; readonly icon: string; readonly label: string }> {
    return this.#meta.categories.map((c) => ({ ...c }));
  }

  /** APPEARANCEKEYS name → Appearance id (Docs/format/01 §3.6); a copy. */
  appearances(): Map<string, number> {
    return this.#car.appearances();
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

  /**
   * CoreUI version and rendition count from CARHEADER (Docs/format/01 §3.1); undefined when the
   * block is absent, short or fails its check, with the reason in `headerNote`.
   */
  get header(): CatalogHeader | undefined {
    const h = this.#car.header;
    return h === undefined ? undefined : { ...h };
  }

  /** Why `header` is undefined; undefined when it read. */
  get headerNote(): string | undefined {
    return this.#car.headerNote;
  }

  /** Renditions kept without metrics because their TLV was unusable (Docs/format/01 §3.8); a copy. */
  get metricsNotes(): SkipRecord[] {
    return this.#car.metricsNotes;
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

  /**
   * Whether `document` would find a rendition: the same pick (Docs/format/05 §4.4), without
   * throwing when there is none. False for an unknown name; two renditions with the same full
   * tuple still throw, as they do for `document`.
   */
  hasRendition(name: string, master: Master, opts: PickOptions = {}): boolean {
    const entry = this.resolve(name);
    return entry !== undefined && this.#find(entry, master, opts) !== undefined;
  }

  document(name: string, master: Master, opts: PickOptions = {}): BvgDocument {
    return parseBvg(this.#pick(name, master, opts).payload as Uint8Array);
  }

  /** LOCALIZATIONKEYS tag (BCP-47, Docs/format/05 §4.3) → Localization id; a copy. */
  localizations(): Map<string, number> {
    return this.#car.localizations();
  }

  /**
   * The symbol's token-13 localizations (Docs/format/05 §4.3): each non-zero Localization id its
   * vector renditions carry, with the variant axes of those renditions under the rule of
   * `SymbolEntry.variants`. Empty for an unknown name or a symbol with none.
   */
  localizationsOf(name: string): Map<number, VariantAxes> {
    const entry = this.resolve(name);
    const found = new Map<number, { directions: Set<number>; appearances: Set<number> }>();
    if (entry === undefined) return new Map();
    for (const r of this.#car.renditions(entry.identifier)) {
      if (r.payload === null) continue;
      const l = r.key[Token.Localization] ?? 0;
      if (l === 0) continue;
      let f = found.get(l);
      if (f === undefined) found.set(l, (f = { directions: new Set(), appearances: new Set() }));
      f.directions.add(r.key[Token.Direction] ?? 0);
      f.appearances.add(r.key[Token.Appearance] ?? 0);
    }
    const out = new Map<number, VariantAxes>();
    for (const l of sorted(new Set(found.keys()))) {
      const f = found.get(l)!;
      out.set(l, axes(f.directions, f.appearances));
    }
    return out;
  }

  /** Glyph metrics (Docs/format/06 §9.1) of the rendition `document` would pick. */
  metrics(name: string, master: Master, opts: PickOptions = {}): GlyphMetrics {
    const picked = this.#pick(name, master, opts);
    if (picked.metrics === undefined) {
      throw new DecodeError(WHERE, `symbol "${name}" weight ${master}: rendition has no glyph metrics (TLV 1018)`);
    }
    return { ...picked.metrics };
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
   * Docs/format/05 §4.4: filter on (Identifier, GlyphWeight, Localization — 0 unless given) and any fixed axis,
   * take the lowest pair. Two renditions with the same full tuple are an error, not a choice.
   */
  #pick(name: string, master: Master, opts: PickOptions): Rendition {
    const entry = this.resolve(name);
    if (entry === undefined) throw new DecodeError(WHERE, `no symbol named "${name}"`);
    const best = this.#find(entry, master, opts);
    if (best === undefined) {
      const fixed =
        (opts.direction === undefined ? "" : `, direction ${opts.direction}`) +
        (opts.appearance === undefined ? "" : `, appearance ${opts.appearance}`);
      throw new DecodeError(
        WHERE,
        `symbol "${entry.name}" (identifier ${entry.identifier}) has no vector rendition for weight ${master}, localization ${opts.localization ?? 0}${fixed}`,
      );
    }
    return best;
  }

  /** The pick of `#pick`, or undefined when nothing matches; a tie throws. */
  #find(entry: SymbolEntry, master: Master, opts: PickOptions): Rendition | undefined {
    let best: Rendition | undefined;
    let tie = false;
    for (const r of this.#car.renditions(entry.identifier)) {
      if (r.payload === null) continue;
      if (r.key[Token.GlyphWeight] !== master) continue;
      if ((r.key[Token.Localization] ?? 0) !== (opts.localization ?? 0)) continue;
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
        `symbol "${entry.name}": two vector renditions share identifier ${entry.identifier}, weight ${master}, localization ${opts.localization ?? 0}, direction ${d}, appearance ${a} (05 §4.4)`,
      );
    }
    return best;
  }
}

function pair(r: Rendition): [number, number] {
  return [r.key[Token.Direction] ?? 0, r.key[Token.Appearance] ?? 0];
}

function less(direction: number, appearance: number, than: Rendition): boolean {
  const d = than.key[Token.Direction] ?? 0;
  return direction < d || (direction === d && appearance < (than.key[Token.Appearance] ?? 0));
}

/** Docs/format/05 §4.4: Direction only when it holds both 4 and 5, Appearance when it has more than one. */
function axes(directions: Set<number>, appearances: Set<number>): VariantAxes {
  return {
    appearance: appearances.size > 1 ? sorted(appearances) : [],
    direction: directions.has(4) && directions.has(5) ? sorted(directions) : [],
  };
}

function sorted(set: Set<number>): number[] {
  return [...set].sort((a, b) => a - b);
}
