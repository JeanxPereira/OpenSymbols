import { createServer, request } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/run.js";
import { runDemo } from "../../src/demo/cli.js";
import { createDemoHandler, startDemoServer } from "../../src/demo/server.js";
import { ChunkBuilder } from "../../src/demo/chunks.js";
import { moduleSource } from "../../src/generate/module-source.js";

const tmp = mkdtempSync(join(tmpdir(), "opensymbols-demo-"));
const appDir = join(tmp, "app");
const packageDir = join(tmp, "pkg");
let server: Awaited<ReturnType<typeof startDemoServer>>;

beforeAll(async () => {
  mkdirSync(join(appDir, "assets"), { recursive: true });
  mkdirSync(join(packageDir, "chunks"), { recursive: true });
  writeFileSync(join(appDir, "index.html"), "<!doctype html><title>demo</title>");
  writeFileSync(join(appDir, "assets", "app-1.js"), "console.log(1)");
  writeFileSync(join(tmp, "secret.txt"), "secret");
  writeFileSync(join(packageDir, "index.json"), JSON.stringify({ formatVersion: 1, symbols: [] }));
  writeFileSync(join(packageDir, "chunks", "0.json"), "[]");
  server = await startDemoServer({ packageDir, appDir, host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

const get = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

describe("startDemoServer", () => {
  it("serves the app at /", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });
  it("serves package files with content types and cache headers", async () => {
    const idx = await get("/pkg/index.json?x=1");
    expect(idx.status).toBe(200);
    expect(idx.headers.get("content-type")).toContain("application/json");
    expect(idx.headers.get("cache-control")).toBe("no-cache");
    expect((await get("/pkg/chunks/0.json")).status).toBe(200);
    const asset = await get("/assets/app-1.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
  });
  it("refuses to leave the roots", async () => {
    for (const p of ["/pkg/../secret.txt", "/pkg/%2e%2e/secret.txt", "/pkg/..%2fsecret.txt", "/%2e%2e/secret.txt", "/pkg/%2e%2e%5csecret.txt"]) {
      const r = await get(p);
      expect([404, 400]).toContain(r.status);
      expect(await r.text()).not.toContain("secret");
    }
  });
  it("404s directories and missing files, 400s malformed escapes", async () => {
    expect((await get("/pkg/chunks")).status).toBe(404);
    expect((await get("/nope.js")).status).toBe(404);
    expect((await get("/pkg/%E0%A4%A")).status).toBe(400);
  });
  it("supports HEAD and rejects other methods", async () => {
    const h = await get("/", { method: "HEAD" });
    expect(h.status).toBe(200);
    expect(await h.text()).toBe("");
    expect((await get("/", { method: "POST" })).status).toBe(405);
  });
});

/** GET with an explicit Host header (fetch does not let a script set it). */
function getWithHost(url: string, host: string): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const r = request(url, { headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

describe("host check and hardening", () => {
  it("rejects a foreign Host on a loopback bind (DNS rebinding) and accepts local names", async () => {
    const port = new URL(server.url).port;
    expect((await getWithHost(server.url, `evil.example:${port}`)).status).toBe(403);
    expect((await getWithHost(server.url, "evil.example")).status).toBe(403);
    expect((await getWithHost(server.url, `localhost:${port}`)).status).toBe(200);
    expect((await getWithHost(server.url, `127.0.0.1:${port}`)).status).toBe(200);
    expect((await getWithHost(server.url, "localhost")).status).toBe(200);
    expect((await getWithHost(server.url, `[::1]:${port}`)).status).toBe(200);
  });
  it("does not check Host when bound to all interfaces", async () => {
    const open = await startDemoServer({ packageDir, appDir, host: "0.0.0.0", port: 0 });
    try {
      const r = await getWithHost(`http://127.0.0.1:${new URL(open.url).port}/`, "anything.example");
      expect(r.status).toBe(200);
    } finally {
      await open.close();
    }
  });
  it("sends x-content-type-options: nosniff on every response", async () => {
    for (const path of ["/", "/nope.js", "/pkg/index.json"]) {
      expect((await get(path)).headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await get("/", { method: "POST" })).headers.get("x-content-type-options")).toBe("nosniff");
    expect((await getWithHost(server.url, "evil.example")).headers["x-content-type-options"]).toBe("nosniff");
  });
  it("turns an error thrown in the handler into a 500 and keeps going", async () => {
    const handle = createDemoHandler({ packageDir, appDir, host: "127.0.0.1", port: 0 });
    const calls: number[] = [];
    let thrown = false;
    const res = {
      setHeader() {},
      writeHead(status: number) {
        if (!thrown) {
          thrown = true;
          throw new Error("file vanished");
        }
        calls.push(status);
      },
      end() {},
      headersSent: false,
    };
    const req = { method: "HEAD", url: "/", headers: { host: "localhost" } };
    expect(() => handle(req as never, res as never)).not.toThrow();
    expect(calls).toEqual([500]);
    expect(() => handle(req as never, res as never)).not.toThrow();
    expect(calls).toEqual([500, 200]);
  });
  it("does not crash when a file disappears before it is sent", async () => {
    writeFileSync(join(appDir, "gone.js"), "x");
    const r = await get("/gone.js");
    expect(r.status).toBe(200);
    rmSync(join(appDir, "gone.js"));
    expect((await get("/gone.js")).status).toBe(404);
    expect((await get("/")).status).toBe(200);
  });
});

describe("chunks built from the modules (a format 2 package has none on disk)", () => {
  const pkg2 = join(tmp, "pkg2");
  const symbols = [
    { name: "a", component: "A", chunk: 0 },
    { name: "b", component: "B", chunk: 0 },
    { name: "c", component: "C", chunk: 1 },
  ];
  const writeModule = (component: string, data: object) =>
    writeFileSync(join(pkg2, "symbols", `${component}.js`), moduleSource(JSON.stringify(data)));
  let s2: Awaited<ReturnType<typeof startDemoServer>>;
  beforeAll(async () => {
    mkdirSync(join(pkg2, "symbols"), { recursive: true });
    writeFileSync(join(pkg2, "index.json"), JSON.stringify({ formatVersion: 2, symbols }));
    for (const s of symbols) writeModule(s.component, { v: 2, name: s.name });
    s2 = await startDemoServer({ packageDir: pkg2, appDir, host: "127.0.0.1", port: 0 });
  });
  afterAll(() => s2.close());
  const get2 = (path: string, init?: RequestInit) => fetch(new URL(path, s2.url), init);

  it("serves chunks/<n>.json: the modules' data of chunk n, in index order", async () => {
    const r = await get2("/pkg/chunks/0.json");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(await r.json()).toEqual([
      { v: 2, name: "a" },
      { v: 2, name: "b" },
    ]);
    expect(await (await get2("/pkg/chunks/1.json")).json()).toEqual([{ v: 2, name: "c" }]);
    const head = await get2("/pkg/chunks/1.json", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("404s a chunk the index does not have and paths that are not chunks", async () => {
    for (const p of ["/pkg/chunks/2.json", "/pkg/chunks/01.json", "/pkg/chunks/x.json", "/pkg/chunks/0.js"]) {
      expect((await get2(p)).status).toBe(404);
    }
  });

  it("keeps a built chunk until index.json changes, then builds it again", async () => {
    await get2("/pkg/chunks/1.json");
    writeModule("C", { v: 2, name: "c2" });
    expect(await (await get2("/pkg/chunks/1.json")).json()).toEqual([{ v: 2, name: "c" }]);
    const later = JSON.stringify({ formatVersion: 2, symbols, regenerated: true });
    writeFileSync(join(pkg2, "index.json"), later);
    expect(await (await get2("/pkg/chunks/1.json")).json()).toEqual([{ v: 2, name: "c2" }]);
  });

  it("answers 500 for a module that is not one generate writes, and keeps serving", async () => {
    writeFileSync(join(pkg2, "symbols", "B.js"), "export default 1;\n");
    writeFileSync(join(pkg2, "index.json"), JSON.stringify({ formatVersion: 2, symbols, again: true }));
    expect((await get2("/pkg/chunks/0.json")).status).toBe(500);
    expect((await get2("/pkg/chunks/1.json")).status).toBe(200);
  });

  it("refuses an index.json component that is not a module name", () => {
    const evil = join(tmp, "pkg3");
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, "index.json"), JSON.stringify({ symbols: [{ component: "../../secret", chunk: 0 }] }));
    expect(() => new ChunkBuilder(evil).chunk(0)).toThrow(/valid component/);
  });

  it("a format 1 package's chunk file on disk is served as is", async () => {
    expect(await (await get("/pkg/chunks/0.json")).text()).toBe("[]");
  });
});

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
};

describe("demo command", () => {
  it("exits 2 for a directory that is not a generated package", () => {
    const t = io();
    expect(run(["demo", "--package", tmp], {}, t.io)).toBe(2);
    expect(t.err.join("")).toContain("index.json");
  });
  it("exits 2 without --package and for unknown flags", () => {
    expect(run(["demo"], {}, io().io)).toBe(2);
    expect(run(["demo", "--package", packageDir, "--bogus"], {}, io().io)).toBe(2);
    expect(run(["demo", "--package", packageDir, "--out", "x"], {}, io().io)).toBe(2);
  });
  it("exits 2 when the app has not been built", async () => {
    const t = io();
    const r = await runDemo(["--package", packageDir], t.io, { appDir: join(tmp, "missing"), wait: false });
    expect(r.code).toBe(2);
    expect(t.err.join("")).toContain("pnpm build");
  });
  it("exits 2 naming the port when it is busy", async () => {
    const busy = createServer();
    await new Promise<void>((res) => busy.listen(0, "127.0.0.1", res));
    const port = (busy.address() as { port: number }).port;
    const t = io();
    const r = await runDemo(["--package", packageDir, "--port", String(port)], t.io, { appDir, wait: false });
    busy.close();
    expect(r.code).toBe(2);
    expect(t.err.join("")).toContain(String(port));
  });
  it("starts, prints the URL and hands back a handle", async () => {
    const t = io();
    const r = await runDemo(["--package", packageDir, "--port", "0"], t.io, { appDir, wait: false });
    expect(r.code).toBe(0);
    expect(t.out.join("")).toMatch(/^OpenSymbols demo: http:\/\/127\.0\.0\.1:\d+\/$/m);
    await r.handle!.close();
  });
  it("--open with an all-interfaces host opens the loopback URL", async () => {
    const opened: string[] = [];
    const t = io();
    const r = await runDemo(["--package", packageDir, "--port", "0", "--host", "0.0.0.0", "--open"], t.io, {
      appDir,
      wait: false,
      open: (u) => opened.push(u),
    });
    expect(r.code).toBe(0);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await r.handle!.close();
  });
  it("--open with :: opens 127.0.0.1 too", async () => {
    const opened: string[] = [];
    const r = await runDemo(["--package", packageDir, "--port", "0", "--host", "::", "--open"], io().io, {
      appDir,
      wait: false,
      open: (u) => opened.push(u),
    });
    if (r.code === 0) {
      expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      await r.handle!.close();
    }
  });
});
