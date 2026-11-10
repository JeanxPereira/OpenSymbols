import type { LayerData, SymbolData, VariantData } from "@opensymbols/core";

export const layer = (cmd: [number, number], clearBehind = false): LayerData => {
  const st = { paint: { kind: "tint" as const }, opacity: 1, clearBehind };
  return { cmd, role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 };
};

const variant = (layers: LayerData[]): VariantData => ({
  ops: "MLMLZ",
  argCounts: [2, 2, 2, 2, 0],
  masters: {
    4: {
      args: [0, 0, 1, 1, 0, 0, 2, 2],
      viewBox: [0, 0, 10, 5],
      transform: [1, 0, 0, 1, 0, 0],
      metrics: { referencePointSize: 17, baselineOffset: 3, capHeight: 10, leftInset: 0, rightInset: 0 },
    },
  },
  layers,
  variableValueMode: "color",
  vcContinuous: false,
});

export const symbol = (name: string, layers: LayerData[]): SymbolData => ({
  v: 1,
  name,
  palette: "apple",
  variants: { a0d0: variant(layers) },
  defaultVariant: "a0d0",
  modes: ["monochrome"],
  build: { validated: true },
});
