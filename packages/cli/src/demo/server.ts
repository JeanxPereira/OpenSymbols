import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { ChunkBuilder, CHUNK_PATH } from "./chunks.js";

export interface DemoServerOptions {
  packageDir: string;
  appDir: string;
  host: string;
  port: number;
}
export interface DemoServer {
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
  res.end(text);
}

/** The file for `rel` under `root` with its size, or undefined when it escapes the root, is missing or is not a file. */
function resolveInside(root: string, rel: string): { file: string; size: number } | undefined {
  const base = resolve(root);
  const file = resolve(base, rel.replace(/^[/\\]+/, ""));
  const out = relative(base, file);
  if (out === "" || /^\.\.([/\\]|$)/.test(out) || isAbsolute(out)) return undefined;
  try {
    const st = statSync(file);
    return st.isFile() ? { file, size: st.size } : undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackBind(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** The hostname of a Host header, without port or brackets' port. */
function hostName(header: string): string {
  const h = header.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end < 0 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(":");
  return colon < 0 ? h : h.slice(0, colon);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `/pkg/chunks/<n>.json`, built from the package's modules (a format 2 package has no chunks on
 * disk); true when it answered. A chunk the index does not have falls through to a 404.
 */
function serveChunk(chunks: ChunkBuilder, rel: string, req: IncomingMessage, res: ServerResponse): boolean {
  const m = CHUNK_PATH.exec(rel);
  if (m === null) return false;
  const text = chunks.chunk(Number(m[1]));
  if (text === undefined) return false;
  const body = Buffer.from(text, "utf8");
  res.writeHead(200, {
    "content-type": TYPES[".json"]!,
    "content-length": String(body.length),
    "x-content-type-options": "nosniff",
    // Rebuilt when the package is generated again.
    "cache-control": "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

function serve(opts: DemoServerOptions, chunks: ChunkBuilder, req: IncomingMessage, res: ServerResponse): void {
  if (isLoopbackBind(opts.host) && !LOCAL_HOSTS.has(hostName(req.headers.host ?? ""))) {
    send(res, 403, "forbidden host");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    send(res, 405, "method not allowed");
    return;
  }
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  } catch {
    send(res, 400, "bad request");
    return;
  }
  if (path === "/") path = "/index.html";
  const isPkg = path === "/pkg" || path.startsWith("/pkg/");
  const found = isPkg ? resolveInside(opts.packageDir, path.slice("/pkg".length)) : resolveInside(opts.appDir, path);
  // A chunk file on disk (a format 1 package) is served as is; otherwise it is built.
  if (found === undefined && isPkg && serveChunk(chunks, path.slice("/pkg".length), req, res)) return;
  if (found === undefined) {
    send(res, 404, "not found");
    return;
  }
  const headers: Record<string, string> = {
    "content-type": TYPES[extname(found.file).toLowerCase()] ?? "application/octet-stream",
    "content-length": String(found.size),
    "x-content-type-options": "nosniff",
  };
  if (path === "/pkg/index.json") headers["cache-control"] = "no-cache";
  else if (path.startsWith("/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(found.file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

/** The request listener; it never throws: an unexpected error becomes a 500. */
export function createDemoHandler(opts: DemoServerOptions) {
  const chunks = new ChunkBuilder(opts.packageDir);
  return (req: IncomingMessage, res: ServerResponse): void => {
    try {
      serve(opts, chunks, req, res);
    } catch {
      try {
        if (res.headersSent) res.destroy();
        else send(res, 500, "internal error");
      } catch {
        res.destroy();
      }
    }
  };
}

export function startDemoServer(opts: DemoServerOptions): Promise<DemoServer> {
  const server = createServer(createDemoHandler(opts));
  return new Promise((resolvePromise, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      reject(
        e.code === "EADDRINUSE"
          ? new Error(`port ${opts.port} is already in use on ${opts.host}`)
          : new Error(`cannot listen on ${opts.host}:${opts.port}: ${e.message}`),
      );
    });
    server.listen(opts.port, opts.host, () => {
      const { port } = server.address() as AddressInfo;
      const host = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
      resolvePromise({
        url: `http://${host}:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
