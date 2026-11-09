// Test-only writers for BOM stores (Docs/format/01 §2). Big-endian throughout.

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function be32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, false));
  return out;
}

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/**
 * Writes a BOM store. `blocks[i]` becomes block index `i + 1` (index 0 is
 * reserved, Docs/format/01 §2.3); `vars` maps a name to an absolute block index.
 */
export function buildBom(opts: {
  blocks: Uint8Array[];
  vars: Record<string, number>;
}): Uint8Array {
  const headerLength = 32;
  const data: Uint8Array[] = [];
  const table: number[] = [0, 0]; // block 0: (address 0, length 0)
  let at = headerLength;
  for (const block of opts.blocks) {
    table.push(at, block.length);
    data.push(block);
    at += block.length;
  }
  const index = concat([be32(opts.blocks.length + 1), be32(...table)]);
  const indexOffset = at;
  at += index.length;
  const entries = Object.entries(opts.vars);
  const varParts: Uint8Array[] = [be32(entries.length)];
  for (const [name, blockIndex] of entries) {
    varParts.push(be32(blockIndex), Uint8Array.of(name.length), ascii(name));
  }
  const vars = concat(varParts);
  const header = concat([
    ascii("BOMStore"),
    be32(1, opts.blocks.length + 1, indexOffset, index.length, at, vars.length),
  ]);
  return concat([header, ...data, index, vars]);
}

type Pair = [number, number];

function node(leaf: boolean, pairs: Pair[], fwd: number, back: number): Uint8Array {
  return concat([
    Uint8Array.of(0, leaf ? 1 : 0, (pairs.length >> 8) & 0xff, pairs.length & 0xff),
    be32(fwd, back),
    ...pairs.map(([a, b]) => be32(a, b)),
  ]);
}

/**
 * Builds the blocks of a B+tree (Docs/format/01 §2.5-§2.7). The returned blocks
 * occupy indexes `base`, `base + 1`, ...; the tree header is the first. Leaves
 * hold up to `leafCapacity` pairs; internal levels are stacked (same capacity)
 * until a single root remains. Layout: header, then a value block and a key
 * block per entry, then the leaves, then the internal nodes.
 */
export function buildTree(
  entries: [Uint8Array, Uint8Array][],
  leafCapacity: number,
  base: number,
): { blocks: Uint8Array[]; header: number } {
  const blocks: Uint8Array[] = [];
  const add = (block: Uint8Array): number => {
    blocks.push(block);
    return base + blocks.length - 1;
  };
  const header = add(new Uint8Array(0));

  const leafPairs: Pair[][] = [];
  for (let i = 0; i < entries.length; i += leafCapacity) {
    leafPairs.push(
      entries.slice(i, i + leafCapacity).map(([key, value]): Pair => {
        const v = add(value);
        const k = add(key);
        return [v, k]; // leaf: (value, key)
      }),
    );
  }
  if (leafPairs.length === 0) leafPairs.push([]);

  const firstLeaf = base + blocks.length;
  let level = leafPairs.map((pairs, i) => {
    const idx = add(
      node(
        true,
        pairs,
        i + 1 < leafPairs.length ? firstLeaf + i + 1 : 0,
        i > 0 ? firstLeaf + i - 1 : 0,
      ),
    );
    return { idx, firstKey: pairs[0]?.[1] ?? 0 };
  });
  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += leafCapacity) {
      const group = level.slice(i, i + leafCapacity);
      // internal: (child, key)
      const idx = add(node(false, group.map((g): Pair => [g.idx, g.firstKey]), 0, 0));
      next.push({ idx, firstKey: group[0]?.firstKey ?? 0 });
    }
    level = next;
  }
  blocks[header - base] = concat([
    ascii("tree"),
    be32(1, level[0]?.idx ?? 0, 4096, entries.length),
    Uint8Array.of(0),
  ]);
  return { blocks, header };
}
