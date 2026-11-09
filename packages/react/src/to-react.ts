import { createElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { SvgNode } from "@opensymbols/core";

/** SVG attributes whose React name is not a plain kebab-to-camel conversion. */
const ATTR_MAP: Record<string, string> = {
  class: "className",
  "xlink:href": "xlinkHref",
  "xml:space": "xmlSpace",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-opacity": "strokeOpacity",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
};

const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `fill-opacity` -> `fillOpacity`; `aria-*` and `data-*` stay as they are. */
export function reactAttrName(name: string): string {
  if (name.startsWith("aria-") || name.startsWith("data-")) return name;
  return ATTR_MAP[name] ?? camel(name);
}

/** `"vertical-align: 3px; color: red"` -> `{ verticalAlign: "3px", color: "red" }`. */
export function parseStyle(style: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    // Custom properties keep their name; vendor prefixes `-webkit-x` become `WebkitX`.
    const key = prop.startsWith("--") ? prop : camel(prop.replace(/^-ms-/, "ms-"));
    out[key] = value;
  }
  return out as CSSProperties;
}

/** The converted children of `node` (stable elements, so callers can memoise them). */
export function toChildren(node: SvgNode): ReactNode[] {
  const out: ReactNode[] = node.children.map((c, i) => toReact(c, {}, i));
  if (node.text !== undefined) out.push(node.text);
  return out;
}

/**
 * Converts a core `SvgNode` tree to React elements. `rootProps` are merged over the root's
 * attributes (the `style` objects are merged, the rest override).
 */
export function toReact(
  node: SvgNode,
  rootProps: Record<string, unknown> = {},
  key?: string | number,
  children: ReactNode[] = toChildren(node),
): ReactElement {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    props[name === "style" && typeof value === "string" ? "style" : reactAttrName(name)] =
      name === "style" && typeof value === "string" ? parseStyle(value) : value;
  }
  for (const [name, value] of Object.entries(rootProps)) {
    props[name] =
      name === "style" && typeof props.style === "object" && typeof value === "object"
        ? { ...(props.style as object), ...(value as object) }
        : value;
  }
  if (key !== undefined) props.key = key;
  return createElement(node.tag, props, ...children);
}
