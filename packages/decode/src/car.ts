import { BomStore } from "./bom.js";
import { ByteReader } from "./bytes.js";
import { DecodeError } from "./errors.js";

const WHERE = "AssetCatalog";

/** Rendition key tokens that matter for symbols (Docs/format/01 §3.3). */
export const Token = {
  Direction: 4,
  Appearance: 7,
  Dimension2: 9,
  Scale: 12,
  Localization: 13,
  Identifier: 17,
  GlyphWeight: 26,
  GlyphSize: 27,
} as const;

/** Docs/format/01 §3.8: the csiheader is 184 bytes. */
const CSI_HEADER_LENGTH = 184;
/** Docs/format/01 §3.10: DWAR tag, u32 zero, u32 payloadLength. */
const DWAR_HEADER_LENGTH = 12;

export interface RenditionKey {
  [token: number]: number;
}

export interface Rendition {
  key: RenditionKey;
  layout: number;
  name: string;
  /** The bytes inside `DWAR`, or null when the rendition carries no vector drawing. */
  payload: Uint8Array | null;
}

/** One record the reader skipped (Docs/format/01 §6): the tree, its entry index, and why. */
export interface SkipRecord {
  tree: string;
  index: number;
  reason: string;
}

export interface SkipCounts {
  facets: number;
  renditions: number;
  nonVector: number;
  idEntries: number;
}

/** How many skip records are kept with their reasons; the counters count them all. */
export const SKIP_RECORD_LIMIT = 20;

export class AssetCatalog {
  /**
   * Records skipped as malformed (Docs/format/01 §6): facets without an identifier, with a
   * truncated attribute list or a duplicate name (§3.4); bad renditions; id-tree entries
   * (`LOCALIZATIONKEYS`, `APPEARANCEKEYS`) whose value is shorter than a u16 (§3.5).
   * `nonVector` counts renditions kept with a null payload although `renditionLength > 0`
   * (payload tag is not DWAR, §3.10); a layout-1003 slot is not counted.
   */
  readonly skipped: SkipCounts = { facets: 0, renditions: 0, nonVector: 0, idEntries: 0 };

  readonly #skipRecords: SkipRecord[] = [];

  readonly #facets = new Map<string, number>();
  readonly #renditions = new Map<number, Rendition[]>();
  readonly #localizations = new Map<string, number>();
  readonly #appearances = new Map<string, number>();

  private constructor(readonly keyFormat: number[]) {}

  static open(bytes: Uint8Array): AssetCatalog {
    const store = BomStore.open(bytes);
    const keyFormat = readKeyFormat(store);
    const catalog = new AssetCatalog(keyFormat);
    const idSlot = keyFormat.indexOf(Token.Identifier);

    catalog.#readFacets(store);
    catalog.#readRenditions(store, keyFormat, idSlot);
    catalog.#readIdTree(store, "LOCALIZATIONKEYS", catalog.#localizations);
    // Docs/format/01 §3.6: not in the §6 list of trees whose absence fails the catalog.
    if (store.named("APPEARANCEKEYS") !== undefined) {
      catalog.#readIdTree(store, "APPEARANCEKEYS", catalog.#appearances);
    }
    return catalog;
  }

  /** The first SKIP_RECORD_LIMIT skipped records, in reading order; a copy. */
  get skipRecords(): SkipRecord[] {
    return this.#skipRecords.map((r) => ({ ...r }));
  }

  #skip(counter: keyof SkipCounts, tree: string, index: number, reason: string): void {
    this.skipped[counter]++;
    if (this.#skipRecords.length < SKIP_RECORD_LIMIT) this.#skipRecords.push({ tree, index, reason });
  }

  /** Symbol name to Identifier (rendition key token 17), Docs/format/01 §3.4. */
  facets(): Map<string, number> {
    return new Map(this.#facets);
  }

  renditions(identifier: number): Rendition[] {
    return [...(this.#renditions.get(identifier) ?? [])];
  }

  /** Every rendition in the RENDITIONS tree, whether or not a facet names its identifier (Docs/format/01 §3.7). */
  allRenditions(): Rendition[] {
    return [...this.#renditions.values()].flat();
  }

  /** BCP-47 tag to the id that key token 13 carries, Docs/format/01 §3.5. */
  localizations(): Map<string, number> {
    return new Map(this.#localizations);
  }

  /** Appearance name to the id that key token 7 carries, Docs/format/01 §3.6. */
  appearances(): Map<string, number> {
    return new Map(this.#appearances);
  }

  #readFacets(store: BomStore): void {
    const tree = "FACETKEYS";
    let index = -1;
    for (const { key, value } of store.tree(tree)) {
      index++;
      // Docs/format/01 §3.4: name is NUL-terminated or fills the block.
      let end = key.indexOf(0);
      if (end < 0) end = key.length;
      const name = latin1(key.subarray(0, end));
      // Value, little-endian: u32 reserved, u16 attributeCount, (u16 token, u16 value)[].
      if (value.length < 6) {
        this.#skip("facets", tree, index, `facet "${name}": value of ${value.length} bytes, shorter than 6`);
        continue;
      }
      const r = new ByteReader(value, 4);
      const count = r.u16le();
      // Docs/format/01 §3.4 [INF]: an attribute list shorter than its count is malformed.
      if (count * 4 > r.remaining()) {
        this.#skip(
          "facets",
          tree,
          index,
          `facet "${name}": ${count} attributes need ${count * 4} bytes, ${r.remaining()} remain`,
        );
        continue;
      }
      let id: number | undefined;
      for (let i = 0; i < count; i++) {
        const token = r.u16le();
        const v = r.u16le();
        if (token === Token.Identifier && id === undefined) id = v; // first wins
      }
      if (id === undefined) {
        this.#skip("facets", tree, index, `facet "${name}": no Identifier (token 17)`);
        continue;
      }
      // Docs/format/01 §3.4 [INF]: a name twice in one tree keeps the first; the second is counted.
      if (this.#facets.has(name)) {
        this.#skip("facets", tree, index, `duplicate facet name "${name}"`);
        continue;
      }
      this.#facets.set(name, id);
    }
  }

  #readRenditions(store: BomStore, keyFormat: number[], idSlot: number): void {
    const tree = "RENDITIONS";
    let index = -1;
    for (const { key, value } of store.tree(tree)) {
      index++;
      // Docs/format/01 §3.7: one little-endian u16 per KEYFORMAT token.
      if (key.length < keyFormat.length * 2) {
        this.#skip(
          "renditions",
          tree,
          index,
          `key of ${key.length} bytes, KEYFORMAT needs ${keyFormat.length * 2}`,
        );
        continue;
      }
      const kr = new ByteReader(key);
      const parsed: RenditionKey = {};
      for (const token of keyFormat) parsed[token] = kr.u16le();

      const csi = readCsi(value);
      if (typeof csi === "string") {
        this.#skip("renditions", tree, index, csi);
        continue;
      }
      const id = parsed[keyFormat[idSlot] as number] as number;
      let list = this.#renditions.get(id);
      if (list === undefined) {
        list = [];
        this.#renditions.set(id, list);
      }
      if (csi.nonVector) {
        this.#skip("nonVector", tree, index, `"${csi.name}": payload tag is not DWAR (§3.10)`);
      }
      list.push({ key: parsed, layout: csi.layout, name: csi.name, payload: csi.payload });
    }
  }

  /** Docs/format/01 §3.5: key is an ASCII name, value a little-endian u16 id. */
  #readIdTree(store: BomStore, tree: string, into: Map<string, number>): void {
    let index = -1;
    for (const { key, value } of store.tree(tree)) {
      index++;
      let end = key.indexOf(0);
      if (end < 0) end = key.length;
      const name = latin1(key.subarray(0, end));
      if (value.length < 2) {
        // Docs/format/01 §6: a malformed record in a present tree is skipped and counted.
        this.#skip("idEntries", tree, index, `"${name}": value of ${value.length} byte(s), not a u16`);
        continue;
      }
      into.set(name, new ByteReader(value).u16le());
    }
  }
}

/** Docs/format/01 §3.2: u32 tag, u32 version, u32 count, u32 token[count], little-endian. */
function readKeyFormat(store: BomStore): number[] {
  const block = store.named("KEYFORMAT");
  if (block === undefined) {
    throw new DecodeError(WHERE, "no KEYFORMAT block");
  }
  const r = new ByteReader(block);
  r.u32le(); // tag
  r.u32le(); // version
  const count = r.u32le();
  if (count * 4 > r.remaining()) {
    throw new DecodeError(
      WHERE,
      `KEYFORMAT count ${count} needs ${count * 4} bytes, ${r.remaining()} remain`,
    );
  }
  const tokens: number[] = [];
  for (let i = 0; i < count; i++) tokens.push(r.u32le());
  if (!tokens.includes(Token.Identifier)) {
    // Docs/format/01 §3.2: without token 17 names cannot be joined to renditions.
    throw new DecodeError(WHERE, "KEYFORMAT lacks the Identifier token (17)");
  }
  return tokens;
}

/**
 * Docs/format/01 §3.8-§3.10. Returns the reason for a malformed record (skip and count);
 * throws for a tag the format does not describe how to read.
 */
function readCsi(
  value: Uint8Array,
): (Omit<Rendition, "key"> & { nonVector: boolean }) | string {
  if (value.length < CSI_HEADER_LENGTH) {
    return `csiheader value of ${value.length} bytes, shorter than ${CSI_HEADER_LENGTH}`;
  }
  const tag = latin1(value.subarray(0, 4));
  if (tag !== "ISTC") {
    // The doc only says how to read ISTC (little-endian); it does not cover CTSI.
    throw new DecodeError(WHERE, `csiheader tag ${JSON.stringify(tag)} is not "ISTC"`);
  }
  const r = new ByteReader(value, 36);
  const layout = r.u16le();
  const nameBytes = value.subarray(40, 40 + 128);
  let nameEnd = nameBytes.indexOf(0);
  if (nameEnd < 0) nameEnd = nameBytes.length;
  const name = latin1(nameBytes.subarray(0, nameEnd));
  r.seek(168);
  const tlvLength = r.u32le();
  r.seek(180);
  const renditionLength = r.u32le();

  // Docs/format/01 §3.9: renditionLength 0 means no payload, whatever the layout.
  if (renditionLength === 0) return { layout, name, payload: null, nonVector: false };

  // §3.8: the payload starts at 184 + tlvLength, not at 184.
  const start = CSI_HEADER_LENGTH + tlvLength;
  if (start + 4 > value.length) return `"${name}": payload starts past the value's end`;
  if (latin1(value.subarray(start, start + 4)) !== "DWAR") {
    // §3.10: a payload tag other than DWAR is not a vector drawing.
    return { layout, name, payload: null, nonVector: true };
  }
  if (start + DWAR_HEADER_LENGTH > value.length) return `"${name}": DWAR header truncated`;
  const dr = new ByteReader(value, start + 8);
  const length = dr.u32le();
  if (length > dr.remaining()) {
    return `"${name}": DWAR payloadLength ${length}, ${dr.remaining()} bytes remain`;
  }
  return {
    layout,
    name,
    payload: value.subarray(start + DWAR_HEADER_LENGTH, start + DWAR_HEADER_LENGTH + length),
    nonVector: false,
  };
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}
