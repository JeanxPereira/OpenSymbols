import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SymbolData } from "@opensymbols/core";
import { SymbolIcon, type IconProps } from "@opensymbols/react";
import { companionProp, effectLiteral } from "./effects.js";

/** `import { Wifi } from "pkg";` */
export function importLine(pkg: string, component: string): string {
  return `import { ${component} } from "${pkg}";`;
}

/** The side-effect import that registers the effects driver: an `effect` does nothing without it. */
export const EFFECTS_IMPORT = 'import "@opensymbols/animate/react";';

/** `import Wifi from "pkg/Wifi";` */
export function deepImportLine(pkg: string, component: string): string {
  return `import ${component} from "${pkg}/${component}";`;
}

/** The props `jsxFor` writes, in this order, with the defaults it leaves out. */
const PROP_ORDER = [
  ["size", 24],
  ["weight", "regular"],
  ["mode", "monochrome"],
  ["color", "currentColor"],
  ["palette", undefined],
  ["variableValue", undefined],
  ["appearance", "light"],
  ["layout", "box"],
  ["direction", "auto"],
  ["title", undefined],
] as const satisfies ReadonlyArray<readonly [keyof IconProps, unknown]>;

/** The non-default rendering props as JSX attributes, in `PROP_ORDER` order. */
function propParts(props: Partial<IconProps>): string[] {
  const parts: string[] = [];
  for (const [key, def] of PROP_ORDER) {
    const value: unknown = props[key];
    if (value === undefined || value === def) continue;
    if (key === "weight" && value === 4) continue; // 4 is regular
    parts.push(typeof value === "string" ? `${key}=${JSON.stringify(value)}` : `${key}={${JSON.stringify(value)}}`);
  }
  return parts;
}

/**
 * `<Wifi weight="semibold" />`: only non-default props, in a stable order. An `effect` is written last
 * with its non-default options, followed by the prop that plays it (`trigger`, `active` or `visible`).
 */
export function jsxFor(component: string, props: Partial<IconProps>): string {
  const parts = propParts(props);
  if (props.effect) parts.push(`effect={${effectLiteral(props.effect)}}`, companionProp(props.effect));
  return `<${component}${parts.map((p) => ` ${p}`).join("")} />`;
}

/** What the Replace snippet needs besides the two components. */
export interface ReplaceOptions {
  style: "plain" | "downUp" | "upUp" | "offUp";
  magic: boolean;
  speed: number;
}

/** `import { A, B } from "pkg";` and the `Replace` import. */
export function replaceImportLines(pkg: string, from: string, to: string): string {
  return `import { ${from}, ${to} } from "${pkg}";\nimport { Replace } from "@opensymbols/animate/react";`;
}

/**
 * `<Replace from={A} to={B} show={…} style="downUp" />`: the style always (it is the choice that
 * matters), `magic` and `speed` when set, then the icon props both icons get.
 */
export function replaceJsxFor(from: string, to: string, props: Partial<IconProps>, o: ReplaceOptions): string {
  const parts = [`from={${from}}`, `to={${to}}`, 'show={playing ? "to" : "from"}', `style=${JSON.stringify(o.style)}`];
  if (o.magic) parts.push("magic");
  if (o.speed !== 1) parts.push(`speed={${o.speed}}`);
  parts.push(...propParts(props));
  return `<Replace ${parts.join(" ")} />`;
}

/** A generated id prefix (`os-` + the sanitised `useId`) before a mask's `-k<layer>`. */
const GENERATED_ID = /\bos-[A-Za-z0-9_-]*?-k(?=\d)/g;

/**
 * The symbol as a standalone SVG document fragment (`xmlns` set). Mask ids come from `useId`, which
 * differs per render: they are rewritten to `os-k<layer>` so the markup is stable.
 */
export function svgFor(data: SymbolData, props: IconProps): string {
  const markup = renderToStaticMarkup(createElement(SymbolIcon, { ...props, data }));
  return markup.replace(GENERATED_ID, "os-k");
}

/** Writes `text` to the clipboard, falling back to a hidden textarea and `execCommand("copy")`. */
export async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // permission denied or not a secure context: fall back
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("the browser refused to copy");
  } finally {
    area.remove();
  }
}
