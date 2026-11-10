/**
 * The generated-data contract. `opensymbols generate` writes `SymbolWire` (format 2, compact);
 * `decodeSymbol` expands it once into `SymbolData`, the form every runtime reads.
 */

/** The newest wire format written and read. Readers accept every version up to it. */
export const FORMAT_VERSION = 2;

export type WeightName =
  | "ultralight"
  | "thin"
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "heavy"
  | "black";

/** A weight name, or a number on the 1..9 scale (1 Ultralight, 4 Regular, 9 Black). */
export type Weight = WeightName | number;

export type Role = "primary" | "secondary" | "tertiary";

/** Named colours are resolved to CSS at generation time. */
export type PaintData =
  | { kind: "tint" }
  | { kind: "role"; role: Role }
  | { kind: "named"; name: string; light: string; dark: string }
  | { kind: "fixed"; hex: string };

export interface LayerStyleData {
  paint: PaintData;
  opacity: number;
  clearBehind: boolean;
}

export type RenderMode = "monochrome" | "hierarchical" | "multicolor" | "palette";

export interface LayerData {
  /** Command range of the layer within the variant's commands. */
  cmd: [start: number, end: number];
  role: Role;
  modes: Record<RenderMode, LayerStyleData>;
  motionGroup: number;
  variableThreshold?: number;
  /** The remaining `Layer` fields, verbatim, for the animation runtime. */
  anim?: Record<string, unknown>;
}

export interface MasterMetrics {
  referencePointSize: number;
  baselineOffset: number;
  capHeight: number;
  leftInset: number;
  rightInset: number;
}

export type ViewBox = [number, number, number, number];
export type Transform = [number, number, number, number, number, number];

export interface MasterData {
  args: number[];
  viewBox: ViewBox;
  transform: Transform;
  /** TLV 1018 (Docs/format/06 section 9.1); absent when the rendition stores none. */
  metrics?: MasterMetrics;
  /** The `ra` marker in path space (Docs/format/06 section 9.2); absent when the document has none. */
  rotationAnchor?: [number, number];
  /** The glyph metric centre in path space (Docs/format/06 section 9.3); absent without metrics. */
  metricCenter?: [number, number];
}

export interface VariantData {
  /** One char per command (Docs/format/03 section 3.2 letters). */
  ops: string;
  /** Argument count per command. */
  argCounts: number[];
  /** GlyphWeight masters: 1 Ultralight, 4 Regular, 9 Black (Docs/format/01 section 5.2). */
  masters: Partial<Record<1 | 4 | 9, MasterData>>;
  layers: LayerData[];
  variableValueMode: "color" | "draw";
  vcContinuous: boolean;
  anim?: Record<string, unknown>;
}

export interface SymbolData {
  /** The expanded, in-memory form (format 1's layout); format 2 data reaches it through `decodeSymbol`. */
  v: 1;
  name: string;
  palette: "apple" | "stand-in";
  /** Key "a<appearance>d<direction>", "a0d0" first. */
  variants: Record<string, VariantData>;
  defaultVariant: string;
  modes: RenderMode[];
  /** `validated`: the catalog is the reference build (spec section 4); false flags every render `"build"`. */
  build: { validated: boolean };
  /**
   * Localized drawings (Docs/format/05 §4.3), by BCP-47 tag as the catalog names it (`ar`, `hi`,
   * `zh-Hans`), each with its own variants keyed like `variants`. Absent: no localized drawing.
   */
  locales?: Record<string, Record<string, VariantData>>;
}

// ---- format 2: the wire form ----

/** A layer's style in format 2: `opacity` absent means 1, `clearBehind` absent means false. */
export interface LayerStyleWire {
  paint: PaintData;
  opacity?: number;
  clearBehind?: true;
}

/**
 * A layer in format 2. `anim` drops the keys whose value is the default: `alwaysRotates` and
 * `alwaysPulses` false, `tags`, `strokeKeyframes` and `attachments` empty; it is absent when
 * nothing is left.
 */
export interface LayerWire {
  cmd: [start: number, end: number];
  role: Role;
  modes: Record<RenderMode, LayerStyleWire>;
  motionGroup: number;
  variableThreshold?: number;
  anim?: Record<string, unknown>;
}

/** A master in format 2: `args` delta-encoded, `d[i] = a[i] − a[i − 2]` for `i ≥ 2`, `d[i] = a[i]` below. */
export type MasterWire = MasterData;

/** A variant in format 2: no `argCounts` (each op's count is its arity: M 2, L 2, Q 4, C 6, Z 0). */
export interface VariantWire {
  ops: string;
  masters: Partial<Record<1 | 4 | 9, MasterWire>>;
  layers: LayerWire[];
  variableValueMode: "color" | "draw";
  vcContinuous: boolean;
  anim?: Record<string, unknown>;
}

export interface SymbolWire {
  v: 2;
  name: string;
  palette: "apple" | "stand-in";
  variants: Record<string, VariantWire>;
  defaultVariant: string;
  modes: RenderMode[];
  build: { validated: boolean };
  locales?: Record<string, Record<string, VariantWire>>;
}
