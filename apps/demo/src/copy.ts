import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SymbolData } from "@opensymbols/core";
import { SymbolIcon, type IconProps } from "@opensymbols/react";

/** `import { Wifi } from "pkg";` */
export function importLine(pkg: string, component: string): string {
  return `import { ${component} } from "${pkg}";`;
}

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

/** `<Wifi weight="semibold" />`: only non-default props, in a stable order. */
export function jsxFor(component: string, props: Partial<IconProps>): string {
  const parts: string[] = [];
  for (const [key, def] of PROP_ORDER) {
    const value: unknown = props[key];
    if (value === undefined || value === def) continue;
    if (key === "weight" && value === 4) continue; // 4 is regular
    parts.push(typeof value === "string" ? `${key}=${JSON.stringify(value)}` : `${key}={${JSON.stringify(value)}}`);
  }
  return `<${component}${parts.map((p) => ` ${p}`).join("")} />`;
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
