import { useEffect, useRef, useState } from "react";
import type { SymbolData } from "@opensymbols/core";
import type { EffectProps, IconProps } from "@opensymbols/react";
import { copyText, deepImportLine, EFFECTS_IMPORT, importLine, jsxFor, replaceImportLines, replaceJsxFor, svgFor, type ReplaceOptions } from "../copy.js";

const STATUS_MS = 1600;

export interface CopyButtonsProps {
  pkg: string;
  component: string;
  /** Undefined while the symbol's chunk loads: SVG copy waits for it. */
  data: SymbolData | undefined;
  props: IconProps;
  /** The animation panel's effect: written into the JSX only (an SVG is static). */
  effect?: EffectProps | undefined;
  /** The panel is in Replace mode with a target: the import and JSX are the Replace snippet. */
  replace?: (ReplaceOptions & { to: string }) | undefined;
}

type Kind = "import" | "deep-import" | "jsx" | "svg";

const LABELS: Record<Kind, string> = {
  import: "Import",
  "deep-import": "Deep import",
  jsx: "JSX",
  svg: "SVG",
};

export function CopyButtons({ pkg, component, data, props, effect, replace }: CopyButtonsProps) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const jsx = replace ? replaceJsxFor(component, replace.to, props, replace) : jsxFor(component, effect ? { ...props, effect } : props);
  // An effect needs the driver registered (`<Replace>`'s import already loads it).
  const imports = replace
    ? replaceImportLines(pkg, component, replace.to)
    : effect
      ? `${importLine(pkg, component)}\n${EFFECTS_IMPORT}`
      : importLine(pkg, component);
  const text = (kind: Kind): string | undefined => {
    switch (kind) {
      case "import":
        return imports;
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
          {imports}
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
