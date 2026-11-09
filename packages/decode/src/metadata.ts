import { DecodeError } from "./errors.js";
import type { RenderingMode } from "./drawing.js";
import { parsePlist, type PlistValue } from "./plist/index.js";

export interface BundleMetadata {
  availability: Map<string, string>;
  yearToRelease: Map<string, Record<string, string>>;
  aliasToModern: Map<string, string>;
  nofillToFill: Map<string, string>;
  categories: Array<{ key: string; icon: string; label: string }>;
  symbolCategories: Map<string, string[]>;
  order: string[];
  searchTerms: Map<string, string[]>;
  restrictions: Map<string, string>;
}

export interface AppMetadata {
  categoryLabels: Map<string, string>;
  baseSymbols: Map<string, string[]>;
  layersetAvailability: Map<string, RenderingMode[]>;
  palette?: { light: Map<string, string>; dark: Map<string, string> };
}

type Dict = { [k: string]: PlistValue };

const isDict = (v: PlistValue): v is Dict =>
  typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);

function fail(file: string, message: string): never {
  throw new DecodeError(file, `${file}: ${message}`);
}

function loadPlist(files: Map<string, Uint8Array>, file: string): PlistValue | undefined {
  const bytes = files.get(file);
  if (bytes === undefined) return undefined;
  try {
    return parsePlist(bytes);
  } catch (e) {
    if (e instanceof DecodeError) fail(file, e.message);
    throw e;
  }
}

function asDict(file: string, v: PlistValue, what: string): Dict {
  if (!isDict(v)) fail(file, `${what} is not a dict`);
  return v;
}

function asString(file: string, v: PlistValue, what: string): string {
  if (typeof v !== "string") fail(file, `${what} is not a string`);
  return v;
}

function asStringArray(file: string, v: PlistValue, what: string): string[] {
  if (!Array.isArray(v)) fail(file, `${what} is not an array`);
  return v.map((x, i) => asString(file, x, `${what}[${i}]`));
}

function stringMap(file: string, v: PlistValue): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, val] of Object.entries(asDict(file, v, "top level"))) {
    out.set(k, asString(file, val, `value of "${k}"`));
  }
  return out;
}

function stringArrayMap(file: string, v: PlistValue): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, val] of Object.entries(asDict(file, v, "top level"))) {
    out.set(k, asStringArray(file, val, `value of "${k}"`));
  }
  return out;
}

// §2.2 `year_to_release`: year key -> platform -> version. Versions are strings (the
// framework's `[String: [String: String]]`); a bare number is stringified.
function yearToRelease(
  file: string,
  v: PlistValue | undefined,
): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  if (v === undefined) return out;
  for (const [year, platforms] of Object.entries(asDict(file, v, "year_to_release"))) {
    const rec: Record<string, string> = {};
    const entries = Object.entries(asDict(file, platforms, `year_to_release["${year}"]`));
    for (const [platform, version] of entries) {
      if (typeof version !== "string" && typeof version !== "number") {
        fail(file, `year_to_release["${year}"].${platform} is not a version`);
      }
      Object.defineProperty(rec, platform, {
        value: String(version),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    out.set(year, rec);
  }
  return out;
}

/**
 * Docs/format/05 §1.3, §2: the metadata files beside a bundle's `Assets.car`, keyed by file
 * name. `name_availability.plist` is required; every other file is optional and leaves its
 * data empty. A present file that does not parse or has the wrong shape is an error.
 */
export function loadBundleMetadata(files: Map<string, Uint8Array>): BundleMetadata {
  const NA = "name_availability.plist";
  const na = loadPlist(files, NA);
  if (na === undefined) {
    throw new DecodeError(NA, `${NA} is required (Docs/format/05 §1.3) and is missing`);
  }
  const top = asDict(NA, na, "top level");
  if (top.symbols === undefined) fail(NA, "missing key `symbols`");
  const result: BundleMetadata = {
    availability: stringMap(NA, top.symbols),
    yearToRelease: yearToRelease(NA, top.year_to_release),
    aliasToModern: new Map(),
    nofillToFill: new Map(),
    categories: [],
    symbolCategories: new Map(),
    order: [],
    searchTerms: new Map(),
    restrictions: new Map(),
  };

  const optional = (file: string, use: (v: PlistValue) => void): void => {
    const v = loadPlist(files, file);
    if (v !== undefined) use(v);
  };

  optional("name_aliases.strings", (v) => {
    result.aliasToModern = stringMap("name_aliases.strings", v); // §2.3 alias -> modern
  });
  optional("nofill_to_fill.strings", (v) => {
    result.nofillToFill = stringMap("nofill_to_fill.strings", v); // §2.4
  });
  optional("categories.plist", (v) => {
    result.categories = categoryEntries("categories.plist", v).map((c) => ({
      key: c.key,
      icon: c.icon,
      label: c.label ?? "", // §2.5: the bundle's copy has no label
    }));
  });
  optional("symbol_categories.plist", (v) => {
    result.symbolCategories = stringArrayMap("symbol_categories.plist", v); // §2.6
  });
  optional("symbol_order.plist", (v) => {
    result.order = asStringArray("symbol_order.plist", v, "top level"); // §2.7
  });
  optional("symbol_search.plist", (v) => {
    result.searchTerms = stringArrayMap("symbol_search.plist", v); // §2.8
  });
  optional("symbol_restrictions.strings", (v) => {
    result.restrictions = stringMap("symbol_restrictions.strings", v); // §2.10
  });
  return result;
}

function categoryEntries(
  file: string,
  v: PlistValue,
): Array<{ key: string; icon: string; label?: string }> {
  if (!Array.isArray(v)) fail(file, "top level is not an array");
  return v.map((entry, i) => {
    const d = asDict(file, entry, `entry ${i}`);
    if (d.key === undefined) fail(file, `entry ${i} has no key`);
    if (d.icon === undefined) fail(file, `entry ${i} has no icon`);
    const out: { key: string; icon: string; label?: string } = {
      key: asString(file, d.key, `entry ${i} key`),
      icon: asString(file, d.icon, `entry ${i} icon`),
    };
    if (d.label !== undefined) out.label = asString(file, d.label, `entry ${i} label`);
    return out;
  });
}

/**
 * Docs/format/05 §3: the SF Symbols app's files, keyed by file name. Every file is optional;
 * `palette` is undefined when `colors-26.csv` is absent.
 */
export function loadAppMetadata(files: Map<string, Uint8Array>): AppMetadata {
  const result: AppMetadata = {
    categoryLabels: new Map(),
    baseSymbols: new Map(),
    layersetAvailability: new Map(),
  };

  const cats = loadPlist(files, "categories.plist");
  if (cats !== undefined) {
    // §3.2: join onto the bundle's categories by key.
    for (const c of categoryEntries("categories.plist", cats)) {
      if (c.label === undefined) fail("categories.plist", `category "${c.key}" has no label`);
      result.categoryLabels.set(c.key, c.label);
    }
  }

  const baseBytes = files.get("base_symbols_map.json");
  if (baseBytes !== undefined) result.baseSymbols = parseBaseSymbols(baseBytes);

  const layers = loadPlist(files, "layerset_availability.plist");
  if (layers !== undefined) {
    // §3.4: only `hierarchical` and `multicolor` are keyed; monochrome and palette always exist.
    const file = "layerset_availability.plist";
    const top = asDict(file, layers, "top level");
    if (top.symbols === undefined) fail(file, "missing key `symbols`");
    for (const [name, sets] of Object.entries(asDict(file, top.symbols, "symbols"))) {
      const d = asDict(file, sets, `symbols["${name}"]`);
      const modes: RenderingMode[] = ["monochrome"];
      if (d.hierarchical !== undefined) modes.push("hierarchical");
      if (d.multicolor !== undefined) modes.push("multicolor");
      modes.push("palette");
      result.layersetAvailability.set(name, modes);
    }
  }

  const csv = files.get("colors-26.csv");
  if (csv !== undefined) result.palette = parsePalette(new TextDecoder("utf-8").decode(csv));
  return result;
}

function parseBaseSymbols(bytes: Uint8Array): Map<string, string[]> {
  const file = "base_symbols_map.json";
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch (e) {
    fail(file, `not valid JSON (${(e as Error).message})`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    fail(file, "top level is not an object");
  }
  const out = new Map<string, string[]>();
  const owner = new Map<string, string>();
  for (const [base, variants] of Object.entries(json)) {
    if (!Array.isArray(variants) || variants.some((x) => typeof x !== "string")) {
      fail(file, `value of "${base}" is not an array of strings`);
    }
    for (const v of variants as string[]) {
      const prior = owner.get(v);
      // §3.3: a variant listed under two bases is an error, not a choice.
      if (prior !== undefined) {
        fail(file, `variant "${v}" is listed under both "${prior}" and "${base}"`);
      }
      owner.set(v, base);
    }
    out.set(base, variants as string[]);
  }
  return out;
}

// --- colors-26.csv (§3.5, §3.6) ---

const CSV = "colors-26.csv";

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let touched = false; // anything seen on this line, so blank lines can be dropped
  const endRow = (): void => {
    row.push(cell);
    if (touched) rows.push(row);
    row = [];
    cell = "";
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
      touched = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      touched = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += c;
      if (c.trim() !== "") touched = true;
    }
  }
  if (quoted) fail(CSV, "unterminated quoted field");
  endRow();
  return rows;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const roundHalfUp = (x: number): number => Math.floor(x + 0.5);
const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

// §3.6 "A colour cell -> CSS": 3 or 4 decimal parts; r, g, b in 0..255, alpha a percentage.
function colourToCss(cell: string): string | undefined {
  const parts = cell.split(",").map((p) => p.trim());
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  if (!parts.every((p) => NUMBER.test(p))) return undefined;
  const n = parts.map(Number);
  const rgb = n.slice(0, 3);
  if (rgb.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return undefined;
  let css = "#" + rgb.map((v) => hex2(roundHalfUp(v))).join("");
  if (n.length === 4) {
    const p = n[3] as number;
    if (!Number.isFinite(p) || p < 0 || p > 100) return undefined;
    if (p < 100) css += hex2(roundHalfUp((p * 255) / 100));
  }
  return css;
}

function parsePalette(text: string): { light: Map<string, string>; dark: Map<string, string> } {
  const rows = csvRows(text.replace(/^﻿/, ""));
  const head = rows[0];
  if (head === undefined) fail(CSV, "file is empty");
  const cells = head.map((c) => c.trim().replace(/^﻿/, ""));
  const KEY = "macOS Color Name";
  const LIGHT = "Light Standard";
  const DARK = "Dark Standard";
  const keyCol = cells.indexOf(KEY);
  const lightCol = cells.indexOf(LIGHT);
  const darkCol = cells.indexOf(DARK);
  if (keyCol < 0 || lightCol < 0 || darkCol < 0) {
    const found = cells.map((c) => `"${c}"`).join(", ");
    fail(CSV, `needs columns "${KEY}", "${LIGHT}" and "${DARK}"; header cells found: ${found}`);
  }
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[];
    const line = r + 1;
    const key = (row[keyCol] ?? "").trim();
    if (key === "") fail(CSV, `line ${line}: empty "${KEY}"`);
    if (light.has(key)) fail(CSV, `line ${line}: duplicate "${KEY}" "${key}"`);
    for (const [col, name, target] of [
      [lightCol, LIGHT, light],
      [darkCol, DARK, dark],
    ] as const) {
      const raw = row[col] ?? "";
      const css = colourToCss(raw);
      if (css === undefined) {
        fail(CSV, `row "${key}" (line ${line}), column "${name}": cannot read colour "${raw}"`);
      }
      target.set(key, css);
    }
  }
  return { light, dark };
}
