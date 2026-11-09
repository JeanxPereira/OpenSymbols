import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { storedTheme } from "./state.js";
import "./styles.css";

const base = (import.meta.env.VITE_PKG_BASE as string | undefined) || "/pkg";
// Before the first render, so a saved dark theme does not flash light.
document.documentElement.setAttribute("data-theme", storedTheme());

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App base={base} />
  </StrictMode>,
);
