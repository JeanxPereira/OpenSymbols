import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range, type Virtualizer } from "@tanstack/react-virtual";
import type { ChunkCache } from "../data/chunks.js";
import type { DemoIndex } from "../data/index-model.js";

const noop = () => {};
const OVERSCAN_ROWS = 4;

/** The cache's version: changes whenever it reports a change (a chunk landed or failed, a retry). */
export function useCacheVersion(cache: ChunkCache): number {
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(onChange), [cache]);
  return useSyncExternalStore(subscribe, () => cache.version, () => cache.version);
}

/** The element's clientWidth (0 until the first layout), kept current with a ResizeObserver. */
export function useClientWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Position of the selected symbol in `results`, or -1. */
export function useSelectedPos(index: DemoIndex, results: number[], selected: string | undefined): number {
  return useMemo(
    () => (selected === undefined ? -1 : results.findIndex((i) => index.symbols[i]?.name === selected)),
    [index, results, selected],
  );
}

export interface VirtualRowsOptions {
  index: DemoIndex;
  cache: ChunkCache;
  /** `useCacheVersion(cache)`: reruns the chunk requests when the cache changes. */
  version: number;
  /** Indices into `index.symbols`, in display order. */
  results: number[];
  columns: number;
  rowHeight: number;
  paddingY: number;
  scrollRef: RefObject<HTMLElement | null>;
  /** False until the layout is known (the grid's width): renders nothing and requests nothing. */
  enabled: boolean;
  /** A row that is always rendered, even out of view (the active cell's): the grid's tab stop. */
  keepRow: number;
}

/**
 * The row virtualizer shared by the grid and the list. After a render that changes the rendered
 * rows (visible, overscan and the kept row) it pins exactly their chunks in the cache (owner "view"), asks for
 * them nearest the viewport centre first with the highest priority, and prunes the queued rest.
 */
export function useVirtualRows(o: VirtualRowsOptions): Virtualizer<HTMLElement, Element> {
  const { index, cache, version, results, columns, rowHeight, paddingY, scrollRef, enabled, keepRow } = o;
  const rowCount = enabled ? Math.ceil(results.length / columns) : 0;
  const rangeExtractor = useCallback(
    (range: Range) => {
      const rows = defaultRangeExtractor(range);
      if (keepRow < 0 || keepRow >= range.count || rows.includes(keepRow)) return rows;
      return [...rows, keepRow].sort((a, b) => a - b);
    },
    [keepRow],
  );
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN_ROWS,
    paddingStart: paddingY,
    paddingEnd: paddingY,
    rangeExtractor,
    useFlushSync: false,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, columns]);

  const rowsKey = virtualizer
    .getVirtualItems()
    .map((item) => item.index)
    .join(",");
  const range = virtualizer.range;
  const centre = range ? Math.round((range.startIndex + range.endIndex) / 2) : 0;

  useEffect(() => {
    if (!enabled) return;
    const rows = rowsKey === "" ? [] : rowsKey.split(",").map(Number);
    const wanted = new Map<number, number>();
    for (const row of rows) {
      const priority = -Math.abs(row - centre);
      const end = Math.min(results.length, (row + 1) * columns);
      for (let pos = row * columns; pos < end; pos++) {
        const sym = index.symbols[results[pos] as number];
        if (!sym) continue;
        const had = wanted.get(sym.chunk);
        if (had === undefined || priority > had) wanted.set(sym.chunk, priority);
      }
    }
    const keep = new Set(wanted.keys());
    cache.pin("view", keep); // on screen: never evicted, so a landing chunk cannot push out a visible one
    // Highest priority first: free fetch slots go to the first loads requested.
    for (const [chunk, priority] of [...wanted].sort((a, b) => b[1] - a[1])) {
      cache.load(chunk, priority).catch(noop); // pruned/failed loads surface via error() and subscribe
    }
    cache.prune(keep);
  }, [enabled, rowsKey, centre, columns, results, version, cache, index]);

  useEffect(() => () => cache.pin("view", new Set()), [cache]);

  return virtualizer;
}

/** The position a navigation key moves to, or undefined for keys the grid does not handle. */
export function moveTo(key: string, pos: number, columns: number, count: number): number | undefined {
  if (count === 0) return undefined;
  let next: number;
  switch (key) {
    case "ArrowLeft":
      next = pos - 1;
      break;
    case "ArrowRight":
      next = pos + 1;
      break;
    case "ArrowUp":
      next = pos - columns;
      break;
    case "ArrowDown":
      next = pos + columns;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return undefined;
  }
  if (next < 0) return key === "ArrowUp" ? pos : 0;
  if (next >= count) return key === "ArrowDown" ? pos : count - 1;
  return next;
}

export interface SelectionNavOptions {
  index: DemoIndex;
  results: number[];
  /** `useSelectedPos(...)`. */
  selectedPos: number;
  columns: number;
  onSelect: (name: string) => void;
  virtualizer: Virtualizer<HTMLElement, Element>;
  scrollRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}

/**
 * Roving selection for a virtualized grid: the selected cell (or the first) is the one tab stop
 * (its row is kept rendered, see `keepRow`); arrow keys, Home and End move the selection, scroll it
 * into view and focus it once rendered.
 */
export function useSelectionNav(o: SelectionNavOptions) {
  const { index, results, selectedPos, columns, onSelect, virtualizer, scrollRef, enabled } = o;
  const activePos = selectedPos >= 0 ? selectedPos : 0;
  const pendingFocus = useRef<number | undefined>(undefined);

  const select = useCallback(
    (pos: number) => {
      const sym = index.symbols[results[pos] as number];
      if (sym) onSelect(sym.name);
    },
    [index, results, onSelect],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-pos]");
    const from = cell ? Number(cell.dataset.pos) : activePos;
    const next = moveTo(e.key, from, columns, results.length);
    if (next === undefined) return;
    e.preventDefault();
    select(next);
    pendingFocus.current = next;
    virtualizer.scrollToIndex(Math.floor(next / columns));
  };

  // New results: a pending focus would point at a different symbol.
  useEffect(() => {
    pendingFocus.current = undefined;
  }, [results]);

  // Move focus to a keyboard-selected cell once it is rendered.
  useEffect(() => {
    const pos = pendingFocus.current;
    if (pos === undefined) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-pos="${pos}"] .cell-main`);
    if (target) {
      target.focus({ preventScroll: true });
      pendingFocus.current = undefined;
    }
  });

  // Once the layout is known (first load from a URL, or a grid/list switch) the selection scrolls
  // into view, with the final column count.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !enabled) return;
    scrolled.current = true;
    if (selectedPos >= 0) virtualizer.scrollToIndex(Math.floor(selectedPos / columns), { align: "center" });
  }, [enabled, selectedPos, columns, virtualizer]);

  return { activePos, select, onKeyDown };
}
