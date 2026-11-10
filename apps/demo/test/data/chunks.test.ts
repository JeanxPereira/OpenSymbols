import type { SymbolData } from "@opensymbols/core";
import { describe, expect, it } from "vitest";
import { ChunkCache, symbolAt } from "../../src/data/chunks.js";
import type { DemoIndex, DemoSymbol } from "../../src/data/index-model.js";

interface Pending {
  url: string;
  ok: () => void;
  fail: (status?: number) => void;
}

/** A fetch whose responses are released by hand. */
function manualFetch() {
  const pending: Pending[] = [];
  const requested: string[] = [];
  let inFlight = 0;
  let maxSeen = 0;
  const fetchFn = ((url: string) => {
    requested.push(url);
    inFlight++;
    maxSeen = Math.max(maxSeen, inFlight);
    return new Promise<Response>((resolve) => {
      const n = Number(/(\d+)\.json$/.exec(url)?.[1]);
      pending.push({
        url,
        ok: () => {
          inFlight--;
          resolve(new Response(JSON.stringify([{ v: 1, id: `s${n}` }]), { status: 200 }));
        },
        fail: (status = 500) => {
          inFlight--;
          resolve(new Response("nope", { status }));
        },
      });
    });
  }) as unknown as typeof fetch;
  return { fetchFn, pending, requested, max: () => maxSeen };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const ids = (d: SymbolData[] | undefined) => d?.map((s) => (s as unknown as { id: string }).id);

describe("ChunkCache", () => {
  it("never has more than 4 loads in flight", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn });
    const all = Array.from({ length: 10 }, (_, i) => cache.load(i, 0));
    await tick();
    expect(m.pending).toHaveLength(4);
    while (m.pending.length) {
      m.pending.shift()?.ok();
      await tick();
      expect(m.max()).toBeLessThanOrEqual(4);
    }
    await Promise.all(all);
    expect(m.requested).toHaveLength(10);
    expect(m.max()).toBe(4);
  });

  it("starts higher priority first and dedupes in-flight and cached loads", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    const first = cache.load(0, 0);
    void cache.load(1, 1);
    void cache.load(2, 5);
    const again = cache.load(0, 0);
    expect(again).toBe(first);
    await tick();
    m.pending.shift()?.ok();
    await tick();
    expect(m.requested).toEqual(["/pkg/chunks/0.json", "/pkg/chunks/2.json"]);
    m.pending.shift()?.ok();
    await tick();
    m.pending.shift()?.ok();
    await tick();
    expect(m.requested).toHaveLength(3);
    await cache.load(2, 0);
    expect(m.requested).toHaveLength(3);
  });

  it("raises the priority of a queued chunk when it is asked for again", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    void cache.load(0, 0);
    void cache.load(1, 1);
    void cache.load(2, 2);
    void cache.load(1, 9);
    await tick();
    m.pending.shift()?.ok();
    await tick();
    expect(m.requested[1]).toBe("/pkg/chunks/1.json");
  });

  it("exposes a failure through error() and retry() fetches again", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn });
    let notified = 0;
    cache.subscribe(() => notified++);
    const p = cache.load(3, 2);
    await tick();
    m.pending.shift()?.fail(503);
    await expect(p).rejects.toThrow(/503/);
    expect(cache.error(3)?.message).toMatch(/\/pkg\/chunks\/3\.json/);
    expect(cache.get(3)).toBeUndefined();
    const afterFail = notified;
    expect(afterFail).toBeGreaterThan(0);

    cache.retry(3);
    expect(cache.error(3)).toBeUndefined();
    await tick();
    expect(m.requested).toHaveLength(2);
    m.pending.shift()?.ok();
    await tick();
    expect(ids(cache.get(3))).toEqual(["s3"]);
    expect(cache.error(3)).toBeUndefined();
    expect(notified).toBeGreaterThan(afterFail);
  });

  it("retry re-queues at the last priority", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    const p = cache.load(0, 7);
    await tick();
    m.pending.shift()?.fail();
    await p.catch(() => {});
    void cache.load(1, 1);
    cache.retry(0);
    void cache.load(2, 3);
    await tick();
    m.pending.shift()?.ok(); // whatever was started first after the failure
    await tick();
    expect(m.requested.slice(0, 3)).toEqual(["/pkg/chunks/0.json", "/pkg/chunks/1.json", "/pkg/chunks/0.json"]);
  });

  it("evicts the least recently used chunk beyond capacity, counting get() as use", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, capacity: 2 });
    let notified = 0;
    for (const n of [0, 1]) {
      const p = cache.load(n, 0);
      await tick();
      m.pending.shift()?.ok();
      await p;
    }
    expect(cache.get(0)).toBeDefined(); // 0 is now more recent than 1
    cache.subscribe(() => notified++);
    const p2 = cache.load(2, 0);
    await tick();
    m.pending.shift()?.ok();
    await p2;
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(2)).toBeDefined();
    expect(notified).toBeGreaterThan(0);
  });

  it("never evicts pinned chunks; holds up to max(capacity, pinned count)", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, capacity: 2 });
    cache.pin("view", new Set([0, 1, 2]));
    for (const n of [0, 1, 2, 3]) {
      const p = cache.load(n, 0);
      await tick();
      m.pending.shift()?.ok();
      await p;
    }
    // 0, 1, 2 pinned (3 > capacity 2) stay; unpinned 3 is evicted as it lands.
    expect([0, 1, 2].every((n) => cache.get(n) !== undefined)).toBe(true);
    expect(cache.get(3)).toBeUndefined();
    // Replacing the pinned set lets now-unpinned chunks go, least recent first, down to capacity.
    cache.pin("view", new Set([2]));
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(2)).toBeDefined();
  });

  it("pinned = the union of every owner's set; replacing one owner's set keeps the others'", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, capacity: 1 });
    cache.pin("inspector", new Set([0]));
    cache.pin("view", new Set([1, 2]));
    for (const n of [0, 1, 2]) {
      const p = cache.load(n, 0);
      await tick();
      m.pending.shift()?.ok();
      await p;
    }
    expect([0, 1, 2].every((n) => cache.get(n) !== undefined)).toBe(true);
    // the view moves on: its old chunks may go, the inspector's stays
    cache.pin("view", new Set([3]));
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeUndefined();
    cache.pin("inspector", new Set());
    const p3 = cache.load(3, 0);
    await tick();
    m.pending.shift()?.ok();
    await p3;
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(3)).toBeDefined();
  });

  it("prune never drops a chunk pinned by any owner", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    const a = cache.load(0, 0);
    const b = cache.load(1, 0);
    await tick();
    cache.pin("inspector", new Set([1]));
    cache.prune(new Set([2]));
    m.pending.shift()?.ok();
    expect(ids(await a)).toEqual(["s0"]);
    await tick();
    m.pending.shift()?.ok();
    expect(ids(await b)).toEqual(["s1"]);
  });

  it("version increases on every change notification", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn });
    const v0 = cache.version;
    const p = cache.load(0, 0);
    await tick();
    m.pending.shift()?.ok();
    await p;
    await tick();
    expect(cache.version).toBeGreaterThan(v0);
  });

  it("resolves a load even when the chunk is evicted as soon as it lands", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, capacity: 1 });
    const a = cache.load(0, 0);
    const b = cache.load(1, 0);
    await tick();
    m.pending.shift()?.ok();
    m.pending.shift()?.ok();
    expect(ids(await a)).toEqual(["s0"]);
    expect(ids(await b)).toEqual(["s1"]);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
  });

  it("a re-load of a queued chunk sets its priority, down as well as up", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    void cache.load(0, 0);
    void cache.load(1, 9);
    void cache.load(2, 5);
    void cache.load(1, 1); // lowered below 2
    await tick();
    m.pending.shift()?.ok();
    await tick();
    expect(m.requested[1]).toBe("/pkg/chunks/2.json");
  });

  it("prune drops queued chunks outside keep and rejects their waiters; in-flight ones finish", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    const a = cache.load(0, 0);
    const b = cache.load(1, 0);
    const c = cache.load(2, 0);
    await tick();
    cache.prune(new Set([2]));
    await expect(b).rejects.toMatchObject({ name: "ChunkPruned" });
    m.pending.shift()?.ok();
    expect(ids(await a)).toEqual(["s0"]);
    await tick();
    m.pending.shift()?.ok();
    expect(ids(await c)).toEqual(["s2"]);
    expect(m.requested).toEqual(["/pkg/chunks/0.json", "/pkg/chunks/2.json"]);
    // a pruned chunk can be asked for again
    const again = cache.load(1, 0);
    await tick();
    m.pending.shift()?.ok();
    expect(ids(await again)).toEqual(["s1"]);
  });

  it("a throwing subscriber neither stalls the queue nor starves other subscribers", async () => {
    const m = manualFetch();
    const cache = new ChunkCache("/pkg", { fetchFn: m.fetchFn, maxInFlight: 1 });
    const quiet = console.error;
    console.error = () => {};
    let seen = 0;
    cache.subscribe(() => {
      throw new Error("boom");
    });
    cache.subscribe(() => seen++);
    try {
      const a = cache.load(0, 0);
      const b = cache.load(1, 0);
      await tick();
      m.pending.shift()?.ok();
      await a;
      await tick();
      expect(m.requested).toHaveLength(2);
      m.pending.shift()?.ok();
      await b;
      expect(seen).toBe(2);
    } finally {
      console.error = quiet;
    }
  });

  it("a rejected fetch (network error) releases its slot", async () => {
    const requested: string[] = [];
    const fetchFn = ((url: string) => {
      requested.push(url);
      if (url.endsWith("/0.json")) return Promise.reject(new TypeError("network down"));
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as unknown as typeof fetch;
    const cache = new ChunkCache("/pkg", { fetchFn, maxInFlight: 1 });
    const a = cache.load(0, 1);
    const b = cache.load(1, 0);
    await expect(a).rejects.toThrow(/network down/);
    await b;
    expect(cache.error(0)?.message).toMatch(/network down/);
  });

  it("symbolAt reads a symbol by its position within the chunk", async () => {
    const mk = (name: string, chunk: number): DemoSymbol => ({
      name,
      component: name,
      aliases: [],
      categories: [],
      searchTerms: [],
      year: null,
      modes: [],
      variableValue: false,
      approximate: [],
      chunk,
    });
    const index = {
      symbols: [mk("a", 0), mk("b", 0), mk("c", 1), mk("d", 1)],
    } as unknown as DemoIndex;
    const fetchFn = (async (url: string) => {
      const n = Number(/(\d+)\.json$/.exec(url)?.[1]);
      const names = n === 0 ? ["a", "b"] : ["c", "d"];
      return new Response(JSON.stringify(names.map((id) => ({ v: 1, id }))), { status: 200 });
    }) as unknown as typeof fetch;
    const cache = new ChunkCache("/pkg", { fetchFn });
    expect(symbolAt(cache, index, 3)).toBeUndefined();
    await cache.load(1, 0);
    expect(ids([symbolAt(cache, index, 3) as SymbolData])).toEqual(["d"]);
    expect(ids([symbolAt(cache, index, 2) as SymbolData])).toEqual(["c"]);
    expect(symbolAt(cache, index, 0)).toBeUndefined();
    expect(symbolAt(cache, index, 9)).toBeUndefined();
  });
});

describe("ChunkCache and format 2", () => {
  it("expands format 2 symbols (what the demo server builds from the modules) into SymbolData", async () => {
    const st = { paint: { kind: "tint" } };
    const wire = {
      v: 2,
      name: "w",
      palette: "stand-in",
      variants: {
        a0d0: {
          ops: "MLZ",
          masters: { 4: { args: [3, 5, -2, -3], viewBox: [0, 0, 3, 5], transform: [1, 0, 0, 1, 0, 0] } },
          layers: [{ cmd: [0, 3], role: "primary", modes: { monochrome: st, hierarchical: st, multicolor: st, palette: st }, motionGroup: 0 }],
          variableValueMode: "color",
          vcContinuous: false,
        },
      },
      defaultVariant: "a0d0",
      modes: ["monochrome"],
      build: { validated: false },
    };
    const fetchFn = (async () => new Response(JSON.stringify([wire]), { status: 200 })) as unknown as typeof fetch;
    const cache = new ChunkCache("/pkg", { fetchFn });
    const [data] = await cache.load(0, 0);
    expect(data!.v).toBe(1);
    const v = data!.variants.a0d0!;
    expect(v.argCounts).toEqual([2, 2, 0]);
    expect(v.masters[4]!.args).toEqual([3, 5, 1, 2]);
    expect(v.layers[0]!.modes.monochrome).toEqual({ paint: { kind: "tint" }, opacity: 1, clearBehind: false });
  });
});
