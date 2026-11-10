// A synthetic catalog root on disk for the `generate` tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBplist } from "../../../decode/test/helpers/build-plist.js";
import { buildBvg, LIST_0_0_3_5, type NodeSpec } from "../../../decode/test/helpers/build-bvg.js";
import { buildCar, f32s, le, tlvSection, type CarSpec, type RenditionSpec } from "../../../decode/test/helpers/build-car.js";
import { buildStyle, type StyleClassSpec } from "../../../decode/test/helpers/build-style.js";
import { nibbles, PATH_HEADER } from "../../../decode/test/helpers/nibbles.js";

// Atoms, Docs/format/02 section 3.
const SVG = 0, G = 1, VIEWBOX = 2, PATH = 3, TRANSFORM = 21, D = 22;
const MOTION_GROUP = 34, DRAW_REVERSES = 38, VALUE_MODE = 39, CLEAR_BEHIND = 42;
const ONE = 32, COLOR = 49, DEFAULTS = 52, TRUE = 53, PRIMARY = 55, ID_S = 63, TINT = 86;
const NO_VALUE = 0xff;
const MONO = 0x80, MULTI = 0x81, HIER = 0x82;

const path = (...ns: number[]) => nibbles(...PATH_HEADER, ...ns);
/** M 3 5 L 1 2 Z */
export const P_MLZ = path(0, 0, 0, 3, 5, 0, 0, 0, 1, 2, 7, 0);
/** M 3 5 L 1 2 L 1 2 Z: one extra command. */
export const P_MLLZ = path(0, 0, 0, 3, 5, 0, 0, 0, 1, 2, 0, 0, 0, 1, 2, 7, 0);
/** M 1 1 Z */
export const P_MZ = path(0, 0, 0, 1, 1, 7, 0);

export interface LayerSpec {
  d: Uint8Array;
  /** The layer is a knockout (`-sfsymbols-clear-behind: true`) in every mode. */
  knockout?: boolean;
}

/** `<svg viewBox="0 0 3 5"><g id="s" transform=…>` with one path per layer. */
export function symbolDoc(layers: LayerSpec[], transform = "matrix(1 0 0 1 0 0)"): Uint8Array {
  const pool: Array<string | Uint8Array> = [];
  const s = (v: string | Uint8Array) => {
    let i = pool.indexOf(v);
    if (i < 0) i = pool.push(v) - 1;
    return 89 + i;
  };
  const classes: StyleClassSpec[] = [{ kind: 0x00, layer: 0, value: DEFAULTS, rule: 0 }];
  const shapes: NodeSpec[] = layers.map((l, n) => {
    const first = classes.length;
    const rule = l.knockout === true ? 2 : 1;
    classes.push(
      { kind: MONO, layer: n, value: NO_VALUE, rule },
      { kind: MULTI, layer: n, value: TINT, rule },
      { kind: HIER, layer: n, value: PRIMARY, rule },
    );
    return { tag: PATH, attrs: [{ name: D, value: s(l.d) }], classes: [first, first + 1, first + 2] };
  });
  const style = buildStyle({
    indexWidth: 1,
    offsetWidth: 1,
    classes,
    rules: [
      [
        { property: VALUE_MODE, values: [COLOR] },
        { property: DRAW_REVERSES, values: [TRUE] },
      ],
      [{ property: MOTION_GROUP, values: [ONE] }],
      [
        { property: MOTION_GROUP, values: [ONE] },
        { property: CLEAR_BEHIND, values: [TRUE] },
      ],
    ],
  });
  const g: NodeSpec = { tag: G, attrs: [{ name: TRANSFORM, value: s(transform) }], children: shapes };
  const root: NodeSpec = { tag: SVG, attrs: [{ name: VIEWBOX, value: s(LIST_0_0_3_5) }], children: [g] };
  return buildBvg({ typeCode: 0x11, localStrings: pool, idPairs: [{ stringIndex: ID_S, target: g }], root, style });
}

const metricsTlv = (referencePointSize: number) =>
  tlvSection([
    1018,
    new Uint8Array([...le(4, 7, referencePointSize), ...f32s(0.1, 9.25, 6, 0.5, 0.888672, 0.75, 0.888672)]),
  ]);

/** Key format: Direction, Appearance, Localization, Identifier, GlyphWeight. */
const KEY_FORMAT = [4, 7, 13, 17, 26];

/** Renditions at masters 1, 4, 9 of facet `id`, with `at(m)` the layers of master m. */
export const allMasters = (id: number, at: (m: number) => LayerSpec[]): RenditionSpec[] =>
  [1, 4, 9].map((m) => ({
    key: { 17: id, 26: m },
    payload: symbolDoc(at(m), `matrix(1 0 0 1 ${m} 0)`),
    tlv: metricsTlv(m * 10),
  }));

/** Like `allMasters`, but no rendition carries TLV 1018 (no glyph metrics). */
export const allMastersWithoutMetrics = (id: number, at: (m: number) => LayerSpec[]): RenditionSpec[] =>
  [1, 4, 9].map((m) => ({ key: { 17: id, 26: m }, payload: symbolDoc(at(m), `matrix(1 0 0 1 ${m} 0)`) }));

export interface CatalogSpec {
  /** Facet name -> renditions builder, given the facet's identifier. */
  facets: Array<[string, (id: number) => RenditionSpec[]]>;
  aliases?: Record<string, string>;
  /** The bundle's categories.plist (it has no labels). */
  categories?: Array<{ key: string; icon: string }>;
  /** The bundle's symbol_categories.plist: symbol -> category keys. */
  symbolCategories?: Record<string, string[]>;
  /** Files under app/; no app/ dir when absent. */
  app?: Record<string, Uint8Array | string>;
  /** LOCALIZATIONKEYS: tag -> id (token 13 of a rendition key). */
  localizations?: Record<string, number>;
  /** CARHEADER fields; buildCar's defaults when absent. */
  header?: CarSpec["header"];
}

/** Writes a catalog root at `root`. */
export function writeCatalog(root: string, spec: CatalogSpec): string {
  mkdirSync(join(root, "public"), { recursive: true });
  const facets: Record<string, number> = {};
  const renditions: RenditionSpec[] = [];
  spec.facets.forEach(([name, build], i) => {
    facets[name] = i + 1;
    renditions.push(...build(i + 1));
  });
  writeFileSync(
    join(root, "public", "Assets.car"),
    buildCar({
      keyFormat: KEY_FORMAT,
      facets,
      localizations: spec.localizations ?? {},
      appearances: {},
      renditions,
      ...(spec.header !== undefined ? { header: spec.header } : {}),
    }),
  );
  const files: Record<string, Uint8Array> = {
    // Years for the first 100 facets only: buildBplist's one-byte object refs overflow past ~250 objects.
    "name_availability.plist": buildBplist({
      symbols: Object.fromEntries(spec.facets.slice(0, 100).map(([n]) => [n, "2019"])),
      year_to_release: { "2019": { iOS: "13.0" } },
    }),
    "name_aliases.strings": buildBplist(spec.aliases ?? {}),
    "symbol_categories.plist": buildBplist(spec.symbolCategories ?? {}),
    "symbol_search.plist": buildBplist({}),
  };
  if (spec.categories !== undefined) files["categories.plist"] = buildBplist(spec.categories);
  for (const [f, bytes] of Object.entries(files)) writeFileSync(join(root, "public", f), bytes);
  if (spec.app !== undefined) {
    mkdirSync(join(root, "app"), { recursive: true });
    for (const [f, bytes] of Object.entries(spec.app)) writeFileSync(join(root, "app", f), bytes);
  }
  return root;
}
