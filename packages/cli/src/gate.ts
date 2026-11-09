import {
  parseBvg,
  parseStyleBlock,
  buildDrawing,
  DecodeError,
  type Catalog,
  type Drawing,
  type Master,
  type PickOptions,
  type RenditionKey,
  type SkipRecord,
} from "@opensymbols/decode";
import { describeError } from "./errors.js";

export interface GateFailure {
  name: string;
  key: RenditionKey;
  /** `where: message` for a DecodeError, else the message. */
  error: string;
}

export interface GateResult {
  documents: number;
  failures: GateFailure[];
  /** Symbols whose masters are not point-compatible, each with the first reason found. */
  incompatibleMasters: Array<{ name: string; reason: string }>;
  /** Localized facets (Docs/format/05 §4.3): not master-checked, a spec §3 non-goal. */
  localized: number;
  /** Sum of the container reader's skipped-record counters. */
  skipped: number;
  /** The first skipped records with their reasons (Docs/format/01 §6). */
  skipRecords: SkipRecord[];
  /** Kept renditions without metrics (a bad TLV, 01 §3.8); not a skip, not part of `skipped`. */
  metricsMissing: number;
  /** The first of those, with their reasons. */
  metricsNotes: SkipRecord[];
}

const MASTERS: readonly Master[] = [1, 4, 9];

/**
 * Why two drawings are not point-compatible, or undefined when they are: equal layer counts,
 * and per layer equal command counts, op sequence and argument counts.
 */
export function shapeMismatch(a: Drawing, b: Drawing): string | undefined {
  if (a.layers.length !== b.layers.length) return `layer count ${a.layers.length} vs ${b.layers.length}`;
  for (let i = 0; i < a.layers.length; i++) {
    const pa = a.layers[i]!.path;
    const pb = b.layers[i]!.path;
    if (pa.length !== pb.length) return `command count at layer ${i}: ${pa.length} vs ${pb.length}`;
    for (let j = 0; j < pa.length; j++) {
      const c = pa[j]!;
      const d = pb[j]!;
      if (c.op !== d.op) return `op at layer ${i} cmd ${j}: ${c.op} vs ${d.op}`;
      if (c.args.length !== d.args.length) {
        return `args length at layer ${i} cmd ${j}: ${c.args.length} vs ${d.args.length}`;
      }
    }
  }
  return undefined;
}

export function sameShape(a: Drawing, b: Drawing): boolean {
  return shapeMismatch(a, b) === undefined;
}

export interface FailureGroup {
  error: string;
  /** Failing documents with this error. */
  count: number;
  /** The first five distinct document names. */
  names: string[];
  /** How many distinct document names the group has in all. */
  distinctNames: number;
}

/** Failures grouped by identical error text, in first-seen order. */
export function groupFailures(failures: readonly GateFailure[]): FailureGroup[] {
  const groups = new Map<string, { group: FailureGroup; seen: Set<string> }>();
  for (const f of failures) {
    let g = groups.get(f.error);
    if (g === undefined) {
      g = { group: { error: f.error, count: 0, names: [], distinctNames: 0 }, seen: new Set() };
      groups.set(f.error, g);
    }
    g.group.count++;
    if (!g.seen.has(f.name)) {
      g.seen.add(f.name);
      g.group.distinctNames++;
      if (g.group.names.length < 5) g.group.names.push(f.name);
    }
  }
  return [...groups.values()].map((g) => g.group);
}

/** The first reason the symbol's masters are incompatible under `opts`, or undefined. */
function mastersMismatch(catalog: Catalog, name: string, opts: PickOptions): string | undefined {
  const drawings: Array<[Master, Drawing]> = [];
  for (const m of MASTERS) {
    try {
      drawings.push([m, catalog.drawing(name, m, opts)]);
    } catch (e) {
      return `master ${m}: ${describeError(e)}`;
    }
  }
  const [[m0, first], ...rest] = drawings as [[Master, Drawing], ...Array<[Master, Drawing]>];
  for (const [m, d] of rest) {
    const why = shapeMismatch(first, d);
    if (why !== undefined) return `master ${m0} vs ${m}: ${why}`;
  }
  return undefined;
}

export function runGate(catalog: Catalog): GateResult {
  const s = catalog.skipped;
  const result: GateResult = {
    documents: 0,
    failures: [],
    incompatibleMasters: [],
    localized: 0,
    skipped: s.facets + s.renditions + s.nonVector + s.idEntries,
    skipRecords: catalog.skipRecords,
    metricsMissing: s.metrics,
    metricsNotes: catalog.metricsNotes,
  };

  for (const { name, key, bytes } of catalog.documents()) {
    result.documents++;
    try {
      const doc = parseBvg(bytes);
      const style = parseStyleBlock(doc);
      buildDrawing(doc, style);
      if (style.orphanRules.length > 0) {
        // Spec §10.1: no rule that no class points at (Docs/format/04 §1.2).
        throw new DecodeError("BVG style block", `orphan style rules: ${style.orphanRules.join(",")}`);
      }
    } catch (e) {
      result.failures.push({ name, key, error: describeError(e) });
    }
  }

  for (const entry of catalog.symbols()) {
    if (entry.localizedVariantOf !== undefined) {
      result.localized++;
      continue;
    }
    const appearances = entry.variants.appearance.length > 0 ? entry.variants.appearance : [undefined];
    const directions = entry.variants.direction.length > 0 ? entry.variants.direction : [undefined];
    let reason: string | undefined;
    outer: for (const appearance of appearances) {
      for (const direction of directions) {
        const opts: PickOptions = {};
        if (appearance !== undefined) opts.appearance = appearance;
        if (direction !== undefined) opts.direction = direction;
        const why = mastersMismatch(catalog, entry.name, opts);
        if (why !== undefined) {
          const axes = [
            appearance === undefined ? "" : `appearance ${appearance}`,
            direction === undefined ? "" : `direction ${direction}`,
          ].filter((x) => x !== "");
          reason = axes.length > 0 ? `${axes.join(", ")}: ${why}` : why;
          break outer;
        }
      }
    }
    if (reason !== undefined) result.incompatibleMasters.push({ name: entry.name, reason });
  }
  return result;
}
