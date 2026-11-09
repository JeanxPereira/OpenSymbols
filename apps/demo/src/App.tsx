import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChunkCache } from "./data/chunks.js";
import { loadIndex, type DemoIndex } from "./data/index-model.js";
import { search } from "./data/search.js";
import { Grid } from "./components/Grid.js";
import { ListView } from "./components/ListView.js";
import { Sidebar } from "./components/Sidebar.js";
import { Toolbar } from "./components/Toolbar.js";
import { useAppearance, useDemoState } from "./state.js";

export interface AppProps {
  /** Where the generated package is served ("/pkg"). */
  base: string;
  fetchFn?: typeof fetch;
  createCache?: (base: string) => ChunkCache;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; index: DemoIndex };

const fmt = new Intl.NumberFormat("en-US");

// Loaded on first selection: it brings react-dom/server (for SVG copy), which the grid never needs.
const Inspector = lazy(() => import("./components/Inspector.js").then((m) => ({ default: m.Inspector })));

export function App({ base, fetchFn, createCache }: AppProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let live = true;
    loadIndex(base, fetchFn).then(
      (index) => live && setLoad({ status: "ready", index }),
      (e: unknown) => live && setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [base, fetchFn]);

  if (load.status === "error") {
    return (
      <div className="panel-centre">
        <div className="panel" role="alert">
          <h1>The symbol package could not be loaded</h1>
          <p className="panel-message">{load.message}</p>
        </div>
      </div>
    );
  }
  if (load.status === "loading") {
    return (
      <div className="panel-centre" aria-busy="true">
        <p className="panel-quiet">Loading symbols…</p>
      </div>
    );
  }
  return <Browser index={load.index} base={base} createCache={createCache} />;
}

function Browser({ index, base, createCache }: { index: DemoIndex; base: string; createCache?: AppProps["createCache"] }) {
  const [state, dispatch] = useDemoState();
  const appearance = useAppearance(state.theme);
  const cache = useMemo(() => (createCache ? createCache(base) : new ChunkCache(base)), [createCache, base]);
  const results = useMemo(() => search(index, state.query, state.category), [index, state.query, state.category]);

  const onSelect = useCallback((name: string) => dispatch({ type: "select", selected: name }), [dispatch]);
  const onCategory = useCallback((category: string | undefined) => dispatch({ type: "category", category }), [dispatch]);

  const categoryLabel = index.categories.find((c) => c.key === state.category)?.label ?? "All";
  const count = `${fmt.format(results.length)} ${results.length === 1 ? "symbol" : "symbols"}`;
  const viewProps = {
    index,
    cache,
    results,
    onSelect,
    weight: state.gridWeight,
    mode: state.gridMode,
    appearance,
    label: `${categoryLabel} symbols`,
    ...(state.selected !== undefined ? { selected: state.selected } : {}),
  };

  return (
    <div className="app">
      <div className="app-sidebar">
        <div className="brand">
          <span className="brand-name">OpenSymbols</span>
          <span className="brand-package">{index.package.name}</span>
        </div>
        <Sidebar categories={index.categories} total={index.symbols.length} category={state.category} onCategory={onCategory} />
      </div>
      <main className="app-main">
        <Toolbar state={state} dispatch={dispatch} />
        <div className="status" role="status">
          <span>{count}</span>
          {state.query && <span className="status-query"> for “{state.query}”</span>}
          {state.category && <span className="status-query"> in {categoryLabel}</span>}
        </div>
        {results.length === 0 ? (
          <div className="empty">
            <p>{state.query ? `No symbols match “${state.query}”.` : "No symbols in this category."}</p>
          </div>
        ) : state.view === "grid" ? (
          <Grid {...viewProps} cellSize={state.cellSize} />
        ) : (
          <ListView {...viewProps} />
        )}
      </main>
      <aside className="app-inspector" aria-label="Inspector">
        {state.selected ? (
          <Suspense fallback={<h2 className="inspector-name">{state.selected}</h2>}>
            <Inspector
              index={index}
              cache={cache}
              name={state.selected}
              gridWeight={state.gridWeight}
              gridMode={state.gridMode}
              appearance={appearance}
            />
          </Suspense>
        ) : (
          <p className="panel-quiet">Select a symbol</p>
        )}
      </aside>
    </div>
  );
}
