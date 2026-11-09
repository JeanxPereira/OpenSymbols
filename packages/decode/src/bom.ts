import { ByteReader } from "./bytes.js";
import { DecodeError } from "./errors.js";

const WHERE = "BomStore";

/** Docs/format/01 §2.2: the header is 32 bytes. */
const HEADER_LENGTH = 32;
/** Docs/format/01 §2.5: tree header is magic, version, root, blockSize, pathCount, u8. */
const TREE_HEADER_LENGTH = 21;
/** Docs/format/01 §2.6: node header is u16 isLeaf, u16 count, u32 forward, u32 backward. */
const NODE_HEADER_LENGTH = 12;

interface BlockRange {
  address: number;
  length: number;
}

export interface TreeEntry {
  key: Uint8Array;
  value: Uint8Array;
}

/** A BOM store (Docs/format/01 §2): big-endian container of numbered blocks. */
export class BomStore {
  readonly #bytes: Uint8Array;
  readonly #blocks: BlockRange[];
  readonly #vars: Map<string, number>;

  private constructor(
    bytes: Uint8Array,
    blocks: BlockRange[],
    vars: Map<string, number>,
  ) {
    this.#bytes = bytes;
    this.#blocks = blocks;
    this.#vars = vars;
  }

  static open(bytes: Uint8Array): BomStore {
    if (bytes.length < HEADER_LENGTH) {
      throw new DecodeError(WHERE, `file is ${bytes.length} bytes, header needs ${HEADER_LENGTH}`);
    }
    const r = new ByteReader(bytes);
    // Docs/format/01 §2.2: magic "BOMStore", then big-endian u32 fields.
    const magic = r.ascii(8);
    if (magic !== "BOMStore") {
      throw new DecodeError(WHERE, `bad magic ${JSON.stringify(magic)}`);
    }
    r.u32be(); // version
    r.u32be(); // numberOfBlocks: not authoritative (§2.3)
    const indexOffset = r.u32be();
    r.u32be(); // indexLength
    const varsOffset = r.u32be();
    r.u32be(); // varsLength

    // Docs/format/01 §2.3: u32 count, then (u32 address, u32 length) entries.
    r.seek(checkedOffset(bytes, indexOffset, "block table"));
    const count = r.u32be();
    if (count * 8 > r.remaining()) {
      throw new DecodeError(
        WHERE,
        `block table count ${count} needs ${count * 8} bytes, ${r.remaining()} remain`,
      );
    }
    const blocks: BlockRange[] = [];
    for (let i = 0; i < count; i++) {
      blocks.push({ address: r.u32be(), length: r.u32be() });
    }

    // Docs/format/01 §2.4: u32 count, then (u32 blockIndex, u8 nameLength, name).
    r.seek(checkedOffset(bytes, varsOffset, "variables"));
    const varCount = r.u32be();
    if (varCount * 5 > r.remaining()) {
      throw new DecodeError(
        WHERE,
        `variables count ${varCount} needs at least ${varCount * 5} bytes, ${r.remaining()} remain`,
      );
    }
    const vars = new Map<string, number>();
    for (let i = 0; i < varCount; i++) {
      const blockIndex = r.u32be();
      const name = r.ascii(r.u8());
      vars.set(name, blockIndex);
    }
    return new BomStore(bytes, blocks, vars);
  }

  /** Block `index`; block 0 is reserved and never names data (Docs/format/01 §2.3). */
  block(index: number): Uint8Array {
    if (!Number.isInteger(index) || index <= 0 || index >= this.#blocks.length) {
      throw new DecodeError(
        WHERE,
        `block ${index} is outside 1..${this.#blocks.length - 1}`,
      );
    }
    const { address, length } = this.#blocks[index] as BlockRange;
    if (address + length > this.#bytes.length) {
      throw new DecodeError(
        WHERE,
        `block ${index} range ${address}+${length} runs past the ${this.#bytes.length}-byte file`,
      );
    }
    return this.#bytes.subarray(address, address + length);
  }

  named(name: string): Uint8Array | undefined {
    const index = this.#vars.get(name);
    return index === undefined ? undefined : this.block(index);
  }

  /** Every entry of the named B+tree in key order (Docs/format/01 §2.5-§2.8). */
  tree(name: string): TreeEntry[] {
    const header = this.named(name);
    if (header === undefined) {
      throw new DecodeError(WHERE, `no variable named ${name}`);
    }
    if (header.length < TREE_HEADER_LENGTH) {
      throw new DecodeError(WHERE, `tree ${name} header is ${header.length} bytes`);
    }
    const r = new ByteReader(header);
    const magic = r.ascii(4);
    if (magic !== "tree") {
      throw new DecodeError(WHERE, `tree ${name} has magic ${JSON.stringify(magic)}`);
    }
    r.u32be(); // version
    const root = r.u32be();
    if (root === 0) {
      // Docs/format/01 §2.5: root 0 is a corrupt or absent tree, not an empty one.
      throw new DecodeError(WHERE, `tree ${name} has root block 0`);
    }

    // Phase 1: descend through the first pair's child while the node is internal.
    const seen = new Set<number>();
    let index = root;
    let node = this.#node(name, index, seen);
    while (!node.leaf) {
      if (node.count === 0) {
        throw new DecodeError(WHERE, `tree ${name} internal node ${index} has no children`);
      }
      index = node.pair(0)[0]; // internal: first u32 is the child (§2.7)
      node = this.#node(name, index, seen);
    }

    // Phase 2: walk the leaf chain through `forward`. Revisit guard is separate.
    const out: TreeEntry[] = [];
    const leaves = new Set<number>();
    for (;;) {
      if (leaves.has(index)) {
        throw new DecodeError(WHERE, `tree ${name} revisits leaf ${index}`);
      }
      leaves.add(index);
      for (let i = 0; i < node.count; i++) {
        const [value, key] = node.pair(i); // leaf: (value, key) (§2.7)
        out.push({ key: this.block(key), value: this.block(value) });
      }
      if (node.forward === 0) {
        break;
      }
      index = node.forward;
      node = this.#node(name, index, null);
      if (!node.leaf) {
        throw new DecodeError(WHERE, `tree ${name} leaf chain reaches internal node ${index}`);
      }
    }
    return out;
  }

  #node(tree: string, index: number, seen: Set<number> | null): TreeNode {
    if (seen !== null) {
      if (seen.has(index)) {
        throw new DecodeError(WHERE, `tree ${tree} revisits node ${index}`);
      }
      seen.add(index);
    }
    const block = this.block(index);
    if (block.length < NODE_HEADER_LENGTH) {
      throw new DecodeError(WHERE, `tree ${tree} node ${index} is ${block.length} bytes`);
    }
    const r = new ByteReader(block);
    const leaf = r.u16be() !== 0;
    const count = r.u16be();
    const forward = r.u32be();
    r.u32be(); // backward
    if (block.length < NODE_HEADER_LENGTH + 8 * count) {
      throw new DecodeError(
        WHERE,
        `tree ${tree} node ${index} holds ${count} pairs but is ${block.length} bytes`,
      );
    }
    return new TreeNode(block, leaf, count, forward);
  }
}

class TreeNode {
  constructor(
    readonly block: Uint8Array,
    readonly leaf: boolean,
    readonly count: number,
    readonly forward: number,
  ) {}

  pair(i: number): [number, number] {
    const r = new ByteReader(this.block, NODE_HEADER_LENGTH + 8 * i);
    return [r.u32be(), r.u32be()];
  }
}

function checkedOffset(bytes: Uint8Array, offset: number, what: string): number {
  if (offset + 4 > bytes.length) {
    throw new DecodeError(WHERE, `${what} offset ${offset} is outside the ${bytes.length}-byte file`);
  }
  return offset;
}
