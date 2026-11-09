import { useCallback, useRef } from "react";
import { symbolAt } from "../data/chunks.js";
import { Cell } from "./Cell.js";
import type { SymbolViewProps } from "./Grid.js";
import { useCacheVersion, useSelectedPos, useSelectionNav, useVirtualRows } from "./virtual.js";

const ROW = 40;
const ICON = 20;

/** One row per symbol: icon, name and aliases. Same virtualization and keys as the grid. */
export function ListView(props: SymbolViewProps) {
  const { index, cache, results, selected, onSelect, weight, mode, appearance, label } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const version = useCacheVersion(cache);
  const selectedPos = useSelectedPos(index, results, selected);
  const virtualizer = useVirtualRows({
    index,
    cache,
    version,
    results,
    columns: 1,
    rowHeight: ROW,
    paddingY: 8,
    scrollRef,
    enabled: true,
    keepRow: Math.max(0, selectedPos),
  });
  const nav = useSelectionNav({
    index,
    results,
    selectedPos,
    columns: 1,
    onSelect,
    virtualizer,
    scrollRef,
    enabled: true,
  });

  const onRetry = useCallback(
    (pos: number) => {
      const sym = index.symbols[results[pos] as number];
      if (sym) cache.retry(sym.chunk);
    },
    [cache, index, results],
  );

  return (
    <div className="viewport" ref={scrollRef}>
      <div
        role="grid"
        aria-label={label}
        aria-rowcount={results.length}
        aria-colcount={1}
        className="list"
        style={{ height: virtualizer.getTotalSize() }}
        onKeyDown={nav.onKeyDown}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const i = results[row.index] as number;
          const sym = index.symbols[i];
          if (!sym) return null;
          const data = symbolAt(cache, index, i);
          return (
            <div
              key={sym.name}
              role="row"
              aria-rowindex={row.index + 1}
              className="list-row"
              style={{ transform: `translateY(${row.start}px)`, height: ROW }}
            >
              <Cell
                pos={row.index}
                name={sym.name}
                aliases={sym.aliases}
                layout="row"
                data={data}
                failed={!data && cache.error(sym.chunk) !== undefined}
                iconSize={ICON}
                weight={weight}
                mode={mode}
                appearance={appearance}
                selected={row.index === selectedPos}
                tabbable={row.index === nav.activePos}
                colIndex={1}
                onSelect={nav.select}
                onRetry={onRetry}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
