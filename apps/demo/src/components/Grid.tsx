import { useCallback, useRef } from "react";
import type { RenderingMode, WeightName } from "@opensymbols/core";
import { symbolAt, type ChunkCache } from "../data/chunks.js";
import type { DemoIndex } from "../data/index-model.js";
import { Cell } from "./Cell.js";
import { useCacheVersion, useClientWidth, useSelectedPos, useSelectionNav, useVirtualRows } from "./virtual.js";

export interface SymbolViewProps {
  index: DemoIndex;
  cache: ChunkCache;
  /** Indices into `index.symbols`, in display order. */
  results: number[];
  selected?: string;
  onSelect: (name: string) => void;
  weight: WeightName;
  mode: RenderingMode;
  appearance: "light" | "dark";
  label: string;
}

export const GAP = 8;
export const PAD = 16;
const LABEL = 22;

/** Columns that fit: floor(width / (cellSize + gap)), at least 1. */
export function columnsFor(width: number, cellSize: number): number {
  return Math.max(1, Math.floor((width + GAP) / (cellSize + GAP)));
}

/** The symbol grid: rows of N cells, virtualized by row. */
export function Grid(props: SymbolViewProps & { cellSize: number }) {
  const { index, cache, results, selected, onSelect, weight, mode, appearance, cellSize, label } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const version = useCacheVersion(cache);
  const clientWidth = useClientWidth(scrollRef);
  // Nothing renders or loads until the width is known: columns decide which rows (and chunks) show.
  const enabled = clientWidth > 0;
  const columns = columnsFor(Math.max(0, clientWidth - 2 * PAD), cellSize);
  const rowHeight = cellSize + LABEL + GAP;
  const selectedPos = useSelectedPos(index, results, selected);
  const activePos = selectedPos >= 0 ? selectedPos : 0;
  const virtualizer = useVirtualRows({
    index,
    cache,
    version,
    results,
    columns,
    rowHeight,
    paddingY: PAD - GAP / 2,
    scrollRef,
    enabled,
    keepRow: Math.floor(activePos / columns),
  });
  const nav = useSelectionNav({ index, results, selectedPos, columns, onSelect, virtualizer, scrollRef, enabled });

  const onRetry = useCallback(
    (pos: number) => {
      const sym = index.symbols[results[pos] as number];
      if (sym) cache.retry(sym.chunk);
    },
    [cache, index, results],
  );

  const iconSize = Math.round(cellSize * 0.5);
  const rowCount = Math.ceil(results.length / columns);
  return (
    <div className="viewport" ref={scrollRef}>
      <div
        role="grid"
        aria-label={label}
        aria-rowcount={rowCount}
        aria-colcount={columns}
        className="grid"
        style={{ height: virtualizer.getTotalSize() }}
        onKeyDown={nav.onKeyDown}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const cells = [];
          const end = Math.min(results.length, (row.index + 1) * columns);
          for (let pos = row.index * columns; pos < end; pos++) {
            const i = results[pos] as number;
            const sym = index.symbols[i];
            if (!sym) continue;
            const data = symbolAt(cache, index, i);
            cells.push(
              <Cell
                key={sym.name}
                pos={pos}
                name={sym.name}
                layout="tile"
                data={data}
                failed={!data && cache.error(sym.chunk) !== undefined}
                iconSize={iconSize}
                weight={weight}
                mode={mode}
                appearance={appearance}
                selected={pos === selectedPos}
                tabbable={pos === nav.activePos}
                colIndex={pos - row.index * columns + 1}
                onSelect={nav.select}
                onRetry={onRetry}
              />,
            );
          }
          return (
            <div
              key={row.key}
              role="row"
              aria-rowindex={row.index + 1}
              className="grid-row"
              style={{
                transform: `translateY(${row.start}px)`,
                height: rowHeight - GAP,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: GAP,
                left: PAD,
                right: PAD,
                ["--cell" as string]: `${cellSize}px`,
              }}
            >
              {cells}
            </div>
          );
        })}
      </div>
    </div>
  );
}
