import { memo } from "react";
import type { RenderingMode, SymbolData, WeightName } from "@opensymbols/core";
import { SymbolIcon } from "@opensymbols/react";

export interface CellProps {
  /** Position in the result list. */
  pos: number;
  name: string;
  /** List rows show aliases next to the name. */
  aliases?: string[];
  layout: "tile" | "row";
  /** Undefined while the symbol's chunk is loading. */
  data: SymbolData | undefined;
  failed: boolean;
  iconSize: number;
  weight: WeightName;
  mode: RenderingMode;
  appearance: "light" | "dark";
  selected: boolean;
  /** The grid's single tab stop. */
  tabbable: boolean;
  colIndex: number;
  onSelect: (pos: number) => void;
  onRetry: (pos: number) => void;
}

/**
 * One symbol: a gridcell holding the selectable button (icon and name) and, when its chunk failed,
 * a retry button beside it (a button cannot nest inside another).
 */
export const Cell = memo(function Cell(p: CellProps) {
  const box = { width: p.iconSize, height: p.iconSize };
  let icon;
  if (p.data) {
    icon = (
      <SymbolIcon
        data={p.data}
        size={p.iconSize}
        weight={p.weight}
        mode={p.mode}
        appearance={p.appearance}
        aria-hidden="true"
        focusable="false"
      />
    );
  } else if (p.failed) {
    icon = (
      <span className="cell-failed" style={box} aria-hidden="true">
        !
      </span>
    );
  } else {
    icon = <span className="cell-placeholder" style={box} aria-hidden="true" />;
  }
  const tab = p.tabbable ? 0 : -1;
  return (
    <div
      role="gridcell"
      aria-selected={p.selected}
      aria-colindex={p.colIndex}
      aria-busy={!p.data && !p.failed ? true : undefined}
      className={`cell cell-${p.layout}`}
      data-pos={p.pos}
    >
      <button
        type="button"
        className="cell-main"
        tabIndex={tab}
        title={p.name}
        aria-current={p.selected ? "true" : undefined}
        onClick={() => p.onSelect(p.pos)}
      >
        <span className="cell-icon">{icon}</span>
        <span className="cell-name">{p.name}</span>
        {p.layout === "row" && p.aliases && p.aliases.length > 0 && (
          <span className="cell-aliases">{p.aliases.join(", ")}</span>
        )}
      </button>
      {p.failed && (
        <button
          type="button"
          className="cell-retry"
          data-control="retry"
          tabIndex={tab}
          aria-label={`Retry loading ${p.name}`}
          title="Loading failed. Retry"
          onClick={() => p.onRetry(p.pos)}
        >
          Retry
        </button>
      )}
    </div>
  );
});
