import type { DemoIndex } from "./index-model.js";

const SEP = /[.\-_ ]+/;

interface Text {
  lower: string;
  tokens: string[];
}

interface Prepared {
  name: Text;
  aliases: Text[];
  terms: Text[];
}

const prepared = new WeakMap<DemoIndex, Prepared[]>();

function text(s: string): Text {
  const lower = s.toLowerCase();
  return { lower, tokens: lower.split(SEP) };
}

/** Lowercased text and tokens of every symbol, computed once per index. */
function prepare(index: DemoIndex): Prepared[] {
  let p = prepared.get(index);
  if (!p) {
    p = index.symbols.map((s) => ({ name: text(s.name), aliases: s.aliases.map(text), terms: s.searchTerms.map(text) }));
    prepared.set(index, p);
  }
  return p;
}

function prefixMatch(t: Text, q: string, qn: string): boolean {
  return t.lower.startsWith(q) || t.lower.startsWith(qn) || t.tokens.some((tok) => tok.startsWith(q));
}

const tokenMatch = (t: Text, tok: string): boolean => t.tokens.some((x) => x.startsWith(tok));

/** Several query tokens: each must prefix-match a token of the name (3), an alias (2) or a search term (1); the weakest decides. */
function multiRank(p: Prepared, toks: string[]): number {
  let rank = 3;
  for (const tok of toks) {
    let r = 0;
    if (tokenMatch(p.name, tok)) r = 3;
    else if (p.aliases.some((a) => tokenMatch(a, tok))) r = 2;
    else if (p.terms.some((t) => tokenMatch(t, tok))) r = 1;
    if (r === 0) return 0;
    rank = Math.min(rank, r);
  }
  return rank;
}

/**
 * Indices into `index.symbols`. Empty query: all, in index order. Rank: exact name > name prefix >
 * name token prefix > alias > search term; ties keep index order. A query of several tokens also matches when
 * every token prefix-matches some token of the name, aliases or search terms (name > alias > term). `category` "all"/undefined: no filter.
 */
export function search(index: DemoIndex, query: string, category?: string): number[] {
  const q = query.trim().toLowerCase();
  const qn = q.split(SEP).join(".");
  const toks = q.split(SEP).filter((t) => t !== "");
  const filter = category && category !== "all" ? category : undefined;
  const prep = prepare(index);
  const hits: Array<[rank: number, i: number]> = [];
  index.symbols.forEach((s, i) => {
    if (filter !== undefined && !s.categories.includes(filter)) return;
    if (q === "") {
      hits.push([0, i]);
      return;
    }
    const p = prep[i] as Prepared;
    const name = p.name.lower;
    let rank = 0;
    if (name === q || name === qn) rank = 5;
    else if (name.startsWith(q) || name.startsWith(qn)) rank = 4;
    else if (p.name.tokens.some((t) => t.startsWith(q))) rank = 3;
    else if (p.aliases.some((a) => prefixMatch(a, q, qn))) rank = 2;
    else if (p.terms.some((t) => prefixMatch(t, q, qn))) rank = 1;
    if (toks.length > 1) rank = Math.max(rank, multiRank(p, toks));
    if (rank > 0) hits.push([rank, i]);
  });
  if (q !== "") hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return hits.map(([, i]) => i);
}
