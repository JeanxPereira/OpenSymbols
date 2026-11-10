/** The generated-data contract: what `opensymbols generate` writes and the runtimes read. */

export const FORMAT_VERSION = 1;

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
  v: 1;
  name: string;
  palette: "apple" | "stand-in";
  /** Key "a<appearance>d<direction>", "a0d0" first. */
  variants: Record<string, VariantData>;
  defaultVariant: string;
  modes: RenderMode[];
  /** `validated`: the catalog is the reference build (spec section 4); false flags every render `"build"`. */
  build: { validated: boolean };
}
