// Docs/format/02-bvg-document.md §3: the 89 predefined atoms
// (`_CSIBVGPredefinedStrings`, CoreUI 26A5416b), in order. Index = atom number.
export const PREDEFINED: readonly string[] = [
  "svg", "g", "viewBox", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", // 0-9
  "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "fill", // 10-19
  "opacity", "transform", "d", "points", "id", "class", "x1", "y1", "x2", "y2", // 20-29
  "none", "0", "1", "0.0", // 30-33
  "-sfsymbols-motion-group", "-sfsymbols-variable-threshold", "-sfsymbols-layer-tags", // 34-36
  "-sfsymbols-always-rotates", "-sfsymbols-draw-reverses-motion-groups", // 37-38
  "-sfsymbols-variable-value-mode", "-sfsymbols-vc-continuous", "-sfsymbols-always-pulses", // 39-41
  "-sfsymbols-clear-behind", "-sfsymbols-fill-action", "-sfsymbols-indices", // 42-44
  "-sfsymbols-variable-draw", "-sfsymbols-clipstroke-attachments", "-sfsymbols-wiggle-style", // 45-47
  "-sfsymbols-rotates-clockwise", // 48
  "color", "draw", "erase", ".defaults", "true", "false", // 49-54
  "primary", "secondary", "tertiary", "multicolor", "hierarchical", "monochrome", // 55-60
  "data-clipstroke-keyframes", "LayerTree", "s", "ra", "da", // 61-65
  "black", "controlAccentColor", "knockout", "labelColor", "secondaryLabelColor", // 66-70
  "tertiaryLabelColor", "quaternaryLabelColor", "systemBlueColor", "systemBrownColor", // 71-74
  "systemCyanColor", "systemGrayColor", "systemGreenColor", "systemIndigoColor", // 75-78
  "systemMintColor", "systemOrangeColor", "systemPinkColor", "systemPurpleColor", // 79-82
  "systemRedColor", "systemTealColor", "systemYellowColor", "tintColor", "white", "custom", // 83-88
];

/** §2.2: string index 89 is the first local string; local string i has index 89 + i. */
export const LOCAL_BASE = 89;

// §5.1: attribute dispatch is by NAME INDEX, never by text.
export const ATTR_D = 22;
export const ATTR_VIEWBOX = 2;
export const ATTR_CLIPSTROKE_KEYFRAMES = 61;
