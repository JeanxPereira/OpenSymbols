import { UsageError } from "../errors.js";

/**
 * Component names that must not be emitted as-is: globals that an ES module export would shadow badly (a generated `export
 * const Map` would break any code in the module that uses the real `Map`).
 * Matched against the PascalCased result, whose first letter is upper-case, so
 * lowercase JS keywords (`class`, `new`, ...) can never collide.
 */
const RESERVED_COMPONENT_NAMES: ReadonlySet<string> = new Set([
  "Infinity", "NaN", "Object", "Array", "Symbol", "Map", "Set", "Function",
  "String", "Number", "Boolean", "Date", "Error", "Promise", "Proxy", "Reflect",
  "JSON", "Math",
]);

/** PascalCase component name for an SF Symbol name. */
export function componentName(symbol: string): string {
  const parts = symbol.split(/[^A-Za-z0-9]+/).filter((p) => p !== "");
  if (parts.length === 0) {
    throw new UsageError(`symbol "${symbol}" has no letters or digits to build a component name from`);
  }
  let name = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  if (/^[0-9]/.test(name) || RESERVED_COMPONENT_NAMES.has(name)) name = `Sf${name}`;
  return name;
}

export interface AssignedNames {
  /** symbol -> component name */
  names: Map<string, string>;
  /** alias component name -> modern symbol */
  aliasExports: Map<string, string>;
  /** Human-readable notes about skipped aliases. */
  reports: string[];
}

/** Deterministic component names; aliases never override a symbol's component. */
export function assignNames(symbols: string[], aliases: Map<string, string>): AssignedNames {
  const names = new Map<string, string>();
  const owner = new Map<string, string>(); // component -> symbol
  for (const symbol of symbols) {
    const component = componentName(symbol);
    const other = owner.get(component);
    if (other !== undefined) {
      throw new UsageError(`symbols "${other}" and "${symbol}" both map to component "${component}"`);
    }
    owner.set(component, symbol);
    names.set(symbol, component);
  }

  const aliasExports = new Map<string, string>();
  const aliasOwner = new Map<string, string>(); // component -> alias name
  const reports: string[] = [];
  for (const [alias, modern] of aliases) {
    if (!names.has(modern)) {
      reports.push(`alias "${alias}" skipped: modern name "${modern}" is not among the symbols`);
      continue;
    }
    let component: string;
    try {
      component = componentName(alias);
    } catch (e) {
      reports.push(`alias "${alias}" skipped: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const symbolOwner = owner.get(component);
    if (symbolOwner !== undefined) {
      reports.push(`alias "${alias}" skipped: component "${component}" belongs to symbol "${symbolOwner}"`);
      continue;
    }
    const aliasOther = aliasOwner.get(component);
    if (aliasOther !== undefined) {
      reports.push(`alias "${alias}" skipped: component "${component}" already used by alias "${aliasOther}"`);
      continue;
    }
    aliasOwner.set(component, alias);
    aliasExports.set(component, modern);
  }
  return { names, aliasExports, reports };
}
