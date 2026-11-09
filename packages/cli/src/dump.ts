import {
  formatNumber,
  parseBvg,
  parseStyleBlock,
  type Catalog,
  pathToSvg,
  type AttrValue,
  type BvgDocument,
  type BvgNode,
  type RenditionKey,
  type StyleBlock,
} from "@opensymbols/decode";
import { describeError } from "./errors.js";

function attrText(v: AttrValue): string {
  if (v.kind === "list") return v.values.map(formatNumber).join(",");
  if (v.kind === "string") return v.text;
  return pathToSvg(v.commands);
}

/**
 * Canonical text form of one rendition's document: the decoder's regression baseline.
 * `keyFormat` gives the token order (KEYFORMAT); without it tokens are in ascending order.
 */
export function dumpDocument(
  name: string,
  key: RenditionKey,
  doc: BvgDocument,
  style: StyleBlock,
  keyFormat?: readonly number[],
): string {
  const tokens = keyFormat ?? Object.keys(key).map(Number).sort((a, b) => a - b);
  const keyText = tokens
    .filter((t) => key[t] !== undefined)
    .map((t) => `${t}:${key[t]}`)
    .join(",");
  const lines: string[] = [`== ${name} key=${keyText}`];

  const viewBox = doc.root.attrs.find((a) => a.name === "viewBox");
  if (viewBox !== undefined && viewBox.value.kind === "list") {
    lines.push(`viewBox ${viewBox.value.values.map(formatNumber).join(" ")}`);
  }
  style.classes.forEach((c, i) => lines.push(`class ${i} ${c.name} rule=${c.ruleIndex}`));
  style.rules.forEach((decls, n) =>
    lines.push(
      [`rule ${n}`, ...decls.map((d) => `${d.property}=${d.values.join("|")}`)].join(" "),
    ),
  );

  const walk = (node: BvgNode, depth: number): void => {
    const pad = "  ".repeat(depth);
    const head = [`node ${pad}${node.tag}`];
    if (node.id !== undefined) head.push(`id=${node.id}`);
    if (node.classIndices.length > 0) head.push(`class=${node.classIndices.join(",")}`);
    const paths: string[] = [];
    for (const a of node.attrs) {
      if (a.value.kind === "path") paths.push(`${pad}  ${a.name} ${attrText(a.value)}`);
      else if (!(depth === 0 && a.name === "viewBox")) head.push(`${a.name}=${attrText(a.value)}`);
    }
    lines.push(head.join(" "), ...paths);
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(doc.root, 0);
  return lines.join("\n") + "\n";
}

/** Decodes and dumps one rendition; a failure names the document and its key. */
export function dumpRendition(
  catalog: Catalog,
  name: string,
  key: RenditionKey,
  bytes: Uint8Array,
): string {
  try {
    const doc = parseBvg(bytes);
    return dumpDocument(name, key, doc, parseStyleBlock(doc), catalog.keyFormat);
  } catch (e) {
    const keyText = catalog.keyFormat
      .filter((t) => key[t] !== undefined)
      .map((t) => `${t}:${key[t]}`)
      .join(",");
    throw new Error(`dump failed for "${name}" key=${keyText}: ${describeError(e)}`);
  }
}

/** Writes the dump of every rendition, in document enumeration order, one part at a time. */
export function dumpAllTo(catalog: Catalog, write: (part: string) => void): void {
  for (const { name, key, bytes } of catalog.documents()) {
    write(dumpRendition(catalog, name, key, bytes));
  }
}

/** The dump of every rendition, in document enumeration order. */
export function dumpAll(catalog: Catalog): string {
  const parts: string[] = [];
  dumpAllTo(catalog, (p) => parts.push(p));
  return parts.join("");
}
