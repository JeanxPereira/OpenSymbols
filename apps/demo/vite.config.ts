import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
// The CLI's chunk builder (node built-ins only), so `pnpm dev` serves chunks as `opensymbols demo` does.
import { ChunkBuilder, CHUNK_PATH } from "../../packages/cli/src/demo/chunks.js";

const TYPES: Record<string, string> = { ".json": "application/json", ".js": "text/javascript", ".svg": "image/svg+xml" };

/**
 * Dev only: serves /pkg/* from the directory in env OPENSYMBOLS_PACKAGE (a generated package), and
 * `chunks/<n>.json`, which a format 2 package does not hold, built from its symbol modules.
 */
function servePackage(): Plugin {
  return {
    name: "opensymbols-package",
    configureServer(server) {
      const dir = process.env.OPENSYMBOLS_PACKAGE;
      const chunks = dir ? new ChunkBuilder(resolve(dir)) : undefined;
      server.middlewares.use("/pkg", (req, res, next) => {
        if (!dir) {
          res.statusCode = 404;
          res.end("OPENSYMBOLS_PACKAGE is not set");
          return;
        }
        const root = resolve(dir);
        let rel: string;
        try {
          rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        } catch {
          res.statusCode = 400;
          res.end("bad request");
          return;
        }
        const file = join(root, normalize(rel).replace(/^[/\\]+/, ""));
        const out = relative(root, file);
        if (out === "" || /^\.\.([/\\]|$)/.test(out) || isAbsolute(out) || !existsSync(file) || !statSync(file).isFile()) {
          const chunk = CHUNK_PATH.exec(rel);
          if (chunk === null || chunks === undefined) return next();
          let text: string | undefined;
          try {
            text = chunks.chunk(Number(chunk[1]));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
            return;
          }
          if (text === undefined) return next();
          res.setHeader("content-type", "application/json");
          res.end(text);
          return;
        }
        res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
        const stream = createReadStream(file);
        stream.on("error", () => {
          res.statusCode = 500;
          res.end();
        });
        stream.pipe(res);
      });
    },
  };
}

export default defineConfig({ plugins: [react(), servePackage()] });
