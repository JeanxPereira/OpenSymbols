import { useEffect, useRef, useState } from "react";
import type { SymbolData } from "@opensymbols/core";
import type { IconProps } from "@opensymbols/react";
import { copyText, deepImportLine, importLine, jsxFor, svgFor } from "../copy.js";

const STATUS_MS = 1600;

export interface CopyButtonsProps {
  pkg: string;
  component: string;
  /** Undefined while the symbol's chunk loads: SVG copy waits for it. */
  data: SymbolData | undefined;
  props: IconProps;
}

type Kind = "import" | "deep-import" | "jsx" | "svg";

const LABELS: Record<Kind, string> = {
  import: "Import",
  "deep-import": "Deep import",
  jsx: "JSX",
  svg: "SVG",
};

export function CopyButtons({ pkg, component, data, props }: CopyButtonsProps) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const jsx = jsxFor(component, props);
  const text = (kind: Kind): string | undefined => {
    switch (kind) {
      case "import":
        return importLine(pkg, component);
      case "deep-import":
        return deepImportLine(pkg, component);
      case "jsx":
        return jsx;
      case "svg":
        return data ? svgFor(data, props) : undefined;
    }
  };

  const copy = async (kind: Kind) => {
    const value = text(kind);
    if (value === undefined) return;
    let message: string;
    try {
      await copyText(value);
      message = `Copied ${LABELS[kind]}`;
    } catch {
      message = "Copy failed: the browser blocked the clipboard";
    }
    setStatus(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), STATUS_MS);
  };

  return (
    <section className="copy" aria-label="Copy">
      <pre className="copy-code">
        <code>
          {importLine(pkg, component)}
          {"\n\n"}
          {jsx}
        </code>
      </pre>
      <div className="copy-buttons">
        {(Object.keys(LABELS) as Kind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="button"
            data-copy={kind}
            disabled={kind === "svg" && !data}
            onClick={() => void copy(kind)}
          >
            Copy {LABELS[kind]}
          </button>
        ))}
      </div>
      <p className="copy-status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
