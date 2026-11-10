import { reasonText } from "../reasons.js";

/** Text with `backticked` spans set as code. */
function withCode(text: string) {
  return text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/**
 * Every approximation reason of the preview, with the README's wording; a quiet line when exact.
 * A reason this demo does not know (a newer runtime's) gets a generic line; none at all is exact.
 */
export function ApproximationNotice({ reasons }: { reasons?: readonly string[] | undefined }) {
  const list = [...new Set((reasons ?? []).filter((r) => typeof r === "string" && r !== ""))];
  if (list.length === 0) return <p className="notice-exact">Exact render</p>;
  return (
    <section className="notice" aria-label="Approximations">
      <h3 className="notice-title">Approximate render</h3>
      <ul className="notice-list">
        {list.map((r) => (
          <li key={r} data-reason={r}>
            <code className="notice-reason">{r}</code>{" "}
            <span className="notice-text">{withCode(reasonText(r) ?? "the renderer reported this reason")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
