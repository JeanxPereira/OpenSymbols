import type { SymbolData } from "@opensymbols/core";
import { packageUrl, type DemoIndex } from "./index-model.js";

export interface ChunkCacheOptions {
  maxInFlight?: number;
  capacity?: number;
  fetchFn?: typeof fetch;
}

interface Waiter {
  resolve: (d: SymbolData[]) => void;
  reject: (e: Error) => void;
}

const noop = () => {};

/**
 * Loads `chunks/<n>.json` with a priority queue, bounded concurrency and an LRU of loaded chunks.
 * Pinned chunks are never evicted or pruned. Each owner (the grid or list as "view", the inspector as
 * "inspector") keeps its own pin set and the pinned chunks are their union, so the cache holds up to
 * max(capacity, pinned count) chunks: capacity is exceeded only when more chunks than that are pinned.
 */
export class ChunkCache {
  readonly #base: string;
  readonly #maxInFlight: number;
  readonly #capacity: number;
  readonly #fetch: typeof fetch;
  /** Loaded chunks; Map order is recency (oldest first). */
  readonly #loaded = new Map<number, SymbolData[]>();
  readonly #errors = new Map<number, Error>();
  readonly #inFlight = new Set<number>();
  readonly #queue = new Map<number, { priority: number; seq: number }>();
  readonly #waiters = new Map<number, Waiter[]>();
  readonly #promises = new Map<number, Promise<SymbolData[]>>();
  readonly #lastPriority = new Map<number, number>();
  readonly #subs = new Set<() => void>();
  readonly #pins = new Map<string, Set<number>>();
  #seq = 0;
  #version = 0;

  constructor(base: string, opts: ChunkCacheOptions = {}) {
    this.#base = base;
    this.#maxInFlight = opts.maxInFlight ?? 4;
    this.#capacity = opts.capacity ?? 24;
    this.#fetch = opts.fetchFn ?? ((...a) => fetch(...a));
  }

  /** The loaded chunk, or undefined. Counts as an access for LRU. */
  get(chunk: number): SymbolData[] | undefined {
    const data = this.#loaded.get(chunk);
    if (data) this.#touch(chunk, data);
    return data;
  }

  /** Increases on every change notification; a snapshot for `useSyncExternalStore`. */
  get version(): number {
    return this.#version;
  }

  /**
   * Replaces `owner`'s pin set (an empty set removes it); other owners' pins are kept. Pinned chunks
   * are never evicted; unpinned ones beyond `capacity` go, least recently used first (also right
   * away, for chunks this call unpins).
   */
  pin(owner: string, chunks: Set<number>): void {
    if (chunks.size === 0) this.#pins.delete(owner);
    else this.#pins.set(owner, new Set(chunks));
    this.#evict();
  }

  /** Pinned by any owner. */
  #isPinned(chunk: number): boolean {
    for (const set of this.#pins.values()) if (set.has(chunk)) return true;
    return false;
  }

  error(chunk: number): Error | undefined {
    return this.#errors.get(chunk);
  }

  /** Higher priority starts first. Deduped against cached, queued and in-flight loads. */
  load(chunk: number, priority: number): Promise<SymbolData[]> {
    this.#lastPriority.set(chunk, priority);
    const data = this.#loaded.get(chunk);
    if (data) {
      this.#touch(chunk, data);
      return Promise.resolve(data);
    }
    const err = this.#errors.get(chunk);
    if (err) return Promise.reject(err);
    const existing = this.#promises.get(chunk);
    if (existing) {
      const q = this.#queue.get(chunk);
      if (q) q.priority = priority; // the latest request wins, up or down
      return existing;
    }
    const p = new Promise<SymbolData[]>((resolve, reject) => {
      this.#waiters.set(chunk, [{ resolve, reject }]);
    });
    p.catch(noop); // callers that ignore the promise use error()/subscribe
    this.#promises.set(chunk, p);
    this.#queue.set(chunk, { priority, seq: this.#seq++ });
    this.#pump();
    return p;
  }

  /** Clears a chunk's error and queues it again at its last priority. */
  retry(chunk: number): void {
    if (!this.#errors.delete(chunk)) return;
    this.#notify();
    void this.load(chunk, this.#lastPriority.get(chunk) ?? 0).catch(noop);
  }

  /**
   * Drops queued (not in-flight) chunks outside `keep` and not pinned by any owner; their load()
   * promises reject with a ChunkPruned error.
   */
  prune(keep: Set<number>): void {
    for (const chunk of [...this.#queue.keys()]) {
      if (keep.has(chunk) || this.#isPinned(chunk)) continue;
      this.#queue.delete(chunk);
      this.#promises.delete(chunk);
      const waiters = this.#waiters.get(chunk) ?? [];
      this.#waiters.delete(chunk);
      const err = new Error(`chunk ${chunk} was pruned before it started loading`);
      err.name = "ChunkPruned";
      for (const w of waiters) w.reject(err);
    }
  }

  subscribe(fn: () => void): () => void {
    this.#subs.add(fn);
    return () => void this.#subs.delete(fn);
  }

  #notify(): void {
    this.#version++;
    for (const fn of [...this.#subs]) {
      try {
        fn();
      } catch (e) {
        console.error(e); // one subscriber must not break the others or the queue
      }
    }
  }

  /** Drops least recently used unpinned chunks until at most `capacity` remain (pinned ones always stay). */
  #evict(): void {
    if (this.#loaded.size <= this.#capacity) return;
    let excess = this.#loaded.size - this.#capacity;
    for (const chunk of [...this.#loaded.keys()]) {
      if (excess <= 0) break;
      if (this.#isPinned(chunk)) continue;
      this.#loaded.delete(chunk);
      excess--;
    }
  }

  #touch(chunk: number, data: SymbolData[]): void {
    this.#loaded.delete(chunk);
    this.#loaded.set(chunk, data);
  }

  #pump(): void {
    while (this.#inFlight.size < this.#maxInFlight && this.#queue.size > 0) {
      let best: number | undefined;
      let bestEntry: { priority: number; seq: number } | undefined;
      for (const [chunk, e] of this.#queue) {
        if (!bestEntry || e.priority > bestEntry.priority || (e.priority === bestEntry.priority && e.seq < bestEntry.seq)) {
          best = chunk;
          bestEntry = e;
        }
      }
      if (best === undefined) return;
      this.#queue.delete(best);
      this.#start(best);
    }
  }

  #start(chunk: number): void {
    this.#inFlight.add(chunk);
    const url = packageUrl(this.#base, `chunks/${chunk}.json`);
    void (async () => {
      let data: SymbolData[] | undefined;
      let failure: Error | undefined;
      try {
        const res = await this.#fetch(url);
        if (res.status !== 200) throw new Error(`cannot load ${url}: HTTP ${res.status}`);
        data = (await res.json()) as SymbolData[];
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      }
      this.#inFlight.delete(chunk);
      this.#promises.delete(chunk);
      const waiters = this.#waiters.get(chunk) ?? [];
      this.#waiters.delete(chunk);
      if (data) {
        this.#touch(chunk, data);
        this.#evict();
        for (const w of waiters) w.resolve(data);
      } else if (failure) {
        this.#errors.set(chunk, failure);
        for (const w of waiters) w.reject(failure);
      }
      this.#pump();
      this.#notify();
    })();
  }
}

const chunkStarts = new WeakMap<DemoIndex, Map<number, number>>();

/**
 * The symbol at `index.symbols[i]` if its chunk is loaded. Chunks hold their symbols in index
 * order, so its position in the chunk is `i` minus the index of the chunk's first symbol.
 */
export function symbolAt(cache: ChunkCache, index: DemoIndex, i: number): SymbolData | undefined {
  const sym = index.symbols[i];
  if (!sym) return undefined;
  let starts = chunkStarts.get(index);
  if (!starts) {
    const m = new Map<number, number>();
    index.symbols.forEach((s, k) => {
      if (!m.has(s.chunk)) m.set(s.chunk, k);
    });
    chunkStarts.set(index, m);
    starts = m;
  }
  return cache.get(sym.chunk)?.[i - (starts.get(sym.chunk) ?? 0)];
}
