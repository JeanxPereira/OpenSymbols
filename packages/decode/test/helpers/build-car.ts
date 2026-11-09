// Test-only writer for a synthetic Assets.car (Docs/format/01 §2-§3).
// BOM container big-endian (build-bom.ts); CoreUI structures little-endian.
import { ascii, buildBom, buildTree, concat } from "./build-bom.js";

export function le(width: 2 | 4, ...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * width);
  const view = new DataView(out.buffer);
  values.forEach((v, i) =>
    width === 2 ? view.setUint16(i * 2, v, true) : view.setUint32(i * 4, v, true),
  );
  return out;
}

export interface RenditionSpec {
  /** token -> value; tokens the key format lacks are ignored, absent ones are 0. */
  key: Record<number, number>;
  /** csiheader layout; default 1022 (vector). */
  layout?: number;
  /** Bytes inside DWAR; omit or null for no payload (renditionLength 0). */
  payload?: Uint8Array | null;
  name?: string;
  /** TLV section bytes after the csiheader; default 8 bytes. */
  tlv?: Uint8Array;
  /** csiheader tag; default "ISTC". */
  tag?: string;
  /** Raw payload bytes written instead of a DWAR wrapper (not a vector drawing). */
  rawPayload?: Uint8Array;
  /** Raw key block bytes, replacing the encoded key. */
  rawKey?: Uint8Array;
  /** Raw value block bytes, replacing the csiheader. */
  rawValue?: Uint8Array;
}

export interface CarSpec {
  keyFormat?: number[];
  facets?: Record<string, number>;
  renditions?: RenditionSpec[];
  localizations?: Record<string, number>;
  appearances?: Record<string, number>;
  /** Per-facet extra (token, value) attributes, replacing the identifier. */
  facetAttributes?: Record<string, [number, number][]>;
  /** Raw FACETKEYS (name, value) entries appended after `facets` (duplicates allowed). */
  rawFacets?: [string, Uint8Array][];
  /** Raw LOCALIZATIONKEYS (name, value) entries appended after `localizations`. */
  rawLocalizations?: [string, Uint8Array][];
  /** CARHEADER fields (CoreUI carheader layout, Docs/format/01 §3.1); defaults 1010, 17, rendition count. */
  header?: { coreuiVersion?: number; renditionCount?: number; mainVersionString?: string };
  /** Omit these variables from the BOM. */
  omit?: string[];
}

/** A TLV section: (u32 type, u32 length, bytes) entries (Docs/format/01 §3.8). */
export function tlvSection(...entries: [number, Uint8Array][]): Uint8Array {
  return concat(entries.map(([type, bytes]) => concat([le(4, type, bytes.length), bytes])));
}

/** Little-endian f32 words. */
export function f32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return out;
}

/** The 436-byte CARHEADER written field by field (Docs/format/01 §3.1). */
export function carheader(h: CarSpec["header"] = {}, defaultCount = 0): Uint8Array {
  const coreui = h.coreuiVersion ?? 1010;
  const out = new Uint8Array(436);
  const view = new DataView(out.buffer);
  out.set(ascii("RATC"), 0);
  view.setUint32(4, coreui, true);
  view.setUint32(8, 17, true);
  view.setUint32(12, 0x5a5a5a5a, true); // storageTimestamp
  view.setUint32(16, h.renditionCount ?? defaultCount, true);
  out.set(ascii(h.mainVersionString ?? `@(#)PROGRAM:CoreUI  PROJECT:CoreUI-${coreui}`), 20);
  out.set(ascii("Xcode 27.0 (27A200c) via AssetCatalogAgent-AssetRuntime"), 148);
  return out;
}

export const DEFAULT_KEY_FORMAT = [7, 17, 26];

export function csiheader(spec: RenditionSpec): Uint8Array {
  const tlv = spec.tlv ?? new Uint8Array(8);
  const payload = spec.payload ?? null;
  const wrapper =
    spec.rawPayload !== undefined
      ? spec.rawPayload
      : payload === null ? new Uint8Array(0) : concat([ascii("DWAR"), le(4, 0, payload.length), payload]);
  const head = new Uint8Array(184);
  const view = new DataView(head.buffer);
  head.set(ascii(spec.tag ?? "ISTC"), 0);
  view.setUint16(36, spec.layout ?? 1022, true);
  head.set(ascii(spec.name ?? ""), 40);
  view.setUint32(168, tlv.length, true);
  view.setUint32(180, wrapper.length, true);
  return concat([head, tlv, wrapper]);
}

export function bvg(extra = "payload"): Uint8Array {
  return ascii(`BVG ${extra}`);
}

export function buildCar(spec: CarSpec = {}): Uint8Array {
  const keyFormat = spec.keyFormat ?? DEFAULT_KEY_FORMAT;
  const blocks: Uint8Array[] = [];
  const vars: Record<string, number> = {};
  const add = (name: string, block: Uint8Array) => {
    blocks.push(block);
    if (!spec.omit?.includes(name)) vars[name] = blocks.length;
  };
  const addTree = (name: string, entries: [Uint8Array, Uint8Array][]) => {
    const { blocks: tb, header } = buildTree(entries, 2, blocks.length + 1);
    blocks.push(...tb);
    if (!spec.omit?.includes(name)) vars[name] = header;
  };

  add("CARHEADER", carheader(spec.header, spec.renditions?.length ?? 0));
  add("KEYFORMAT", concat([ascii("TMFK"), le(4, 0, keyFormat.length, ...keyFormat)]));

  const facetEntries = Object.entries(spec.facets ?? {}).map(
    ([name, id]): [Uint8Array, Uint8Array] => {
      const attrs: [number, number][] = spec.facetAttributes?.[name] ?? [
        [1, 85],
        [2, 181],
        [17, id],
        [25, 13],
      ];
      return [
        concat([ascii(name), Uint8Array.of(0)]),
        concat([le(4, 0), le(2, attrs.length), ...attrs.map(([t, v]) => le(2, t, v))]),
      ];
    },
  );
  for (const [name, value] of spec.rawFacets ?? []) {
    facetEntries.push([concat([ascii(name), Uint8Array.of(0)]), value]);
  }
  addTree("FACETKEYS", facetEntries);

  const renditionEntries = (spec.renditions ?? []).map((r): [Uint8Array, Uint8Array] => [
    r.rawKey ?? le(2, ...keyFormat.map((token) => r.key[token] ?? 0)),
    r.rawValue ?? csiheader(r),
  ]);
  addTree("RENDITIONS", renditionEntries);

  const idTree = (rec: Record<string, number>): [Uint8Array, Uint8Array][] =>
    Object.entries(rec).map(([name, id]) => [ascii(name), le(2, id)]);
  addTree("LOCALIZATIONKEYS", [
    ...idTree(spec.localizations ?? {}),
    ...(spec.rawLocalizations ?? []).map(([name, v]): [Uint8Array, Uint8Array] => [ascii(name), v]),
  ]);
  if (spec.appearances !== undefined) addTree("APPEARANCEKEYS", idTree(spec.appearances));

  return buildBom({ blocks, vars });
}
