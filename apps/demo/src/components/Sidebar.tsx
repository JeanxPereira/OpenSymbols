import type { DemoCategory } from "../data/index-model.js";

export interface SidebarProps {
  categories: DemoCategory[];
  total: number;
  category?: string;
  onCategory: (key: string | undefined) => void;
}

const fmt = new Intl.NumberFormat("en-US");

/** "All" plus the package's categories with counts. Under 900 px the CSS swaps the list for a select. */
export function Sidebar({ categories, total, category, onCategory }: SidebarProps) {
  const entries: Array<{ key: string | undefined; label: string; count: number }> = [
    { key: undefined, label: "All", count: total },
    ...categories.map((c) => ({ key: c.key, label: c.label, count: c.count })),
  ];
  return (
    <nav className="sidebar" aria-label="Categories">
      <ul className="sidebar-list">
        {entries.map((e) => {
          const active = e.key === category;
          return (
            <li key={e.key ?? "all"}>
              <button
                type="button"
                className="sidebar-item"
                aria-current={active ? "true" : undefined}
                onClick={() => onCategory(e.key)}
              >
                <span className="sidebar-label">{e.label}</span>
                <span className="sidebar-count">{fmt.format(e.count)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <label className="sidebar-select">
        <span className="visually-hidden">Category</span>
        <select value={category ?? ""} onChange={(ev) => onCategory(ev.target.value || undefined)}>
          {entries.map((e) => (
            <option key={e.key ?? "all"} value={e.key ?? ""}>
              {e.label} ({fmt.format(e.count)})
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
