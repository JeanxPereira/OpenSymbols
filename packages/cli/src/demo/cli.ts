import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { FORMAT_VERSION } from "@opensymbols/core";
import { UsageError, describeError } from "../errors.js";
import type { Io } from "../run.js";
import { startDemoServer, type DemoServer } from "./server.js";

export interface DemoArgs {
  packageDir: string;
  port: number;
  host: string;
  open: boolean;
}

/** Parses and validates `demo` arguments, including the package's index.json. Throws UsageError. */
export function parseDemoArgs(args: string[]): DemoArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { package: { type: "string" }, port: { type: "string" }, host: { type: "string" }, open: { type: "boolean" } },
    });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 0) throw new UsageError(`demo takes no positional arguments: ${positionals.join(" ")}`);
  if (values.package === undefined || values.package === "") throw new UsageError("demo needs --package DIR");
  const port = values.port === undefined ? 4173 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port must be an integer from 0 to 65535");
  const host = values.host ?? "127.0.0.1";
  if (host === "") throw new UsageError("--host must not be empty");
  const packageDir = resolve(values.package);
  checkPackage(packageDir);
  return { packageDir, port, host, open: values.open === true };
}

function checkPackage(packageDir: string): void {
  const file = join(packageDir, "index.json");
  if (!existsSync(file)) throw new UsageError(`${file} not found: --package must be a generated package directory`);
  let index: unknown;
  try {
    index = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${describeError(e)}`);
  }
  const o = index as { formatVersion?: unknown; symbols?: unknown } | null;
  if (typeof o !== "object" || o === null || typeof o.formatVersion !== "number" || !Array.isArray(o.symbols)) {
    throw new UsageError(`${file} is not a generated package index (needs formatVersion and symbols)`);
  }
  if (o.formatVersion > FORMAT_VERSION) {
    throw new UsageError(`${file} has formatVersion ${o.formatVersion}; this opensymbols supports up to ${FORMAT_VERSION}`);
  }
}

/** `dist/demo` next to the running main.js (tsup puts every entry in dist/). */
export function defaultAppDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "demo");
}

function openBrowser(url: string): void {
  const win = process.platform === "win32";
  const cmd = win ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = win ? ["/c", "start", '""', url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: win });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening a browser is a convenience.
  }
}

export interface DemoOptions {
  appDir?: string;
  /** false: return right after listening, with a handle (tests). Default true: block until SIGINT/SIGTERM. */
  wait?: boolean;
  /** Replaces opening the default browser (tests). */
  open?: (url: string) => void;
}
export interface DemoResult {
  code: number;
  handle?: DemoServer;
}

/** The async part of `opensymbols demo`. */
export async function runDemo(args: string[], io: Io, options: DemoOptions = {}): Promise<DemoResult> {
  let handle: DemoServer;
  try {
    const a = parseDemoArgs(args);
    const appDir = options.appDir ?? defaultAppDir();
    if (!existsSync(join(appDir, "index.html"))) {
      throw new UsageError(`the demo app is not built (${appDir} has no index.html): run pnpm build`);
    }
    handle = await startDemoServer({ packageDir: a.packageDir, appDir, host: a.host, port: a.port });
    io.out(`OpenSymbols demo: ${handle.url}\n`);
    if (a.host === "0.0.0.0" || a.host === "::") io.out("listening on all interfaces: anyone on your network can open this page\n");
    if (a.open) {
      const all = a.host === "0.0.0.0" || a.host === "::";
      const url = all ? `http://127.0.0.1:${new URL(handle.url).port}/` : handle.url;
      (options.open ?? openBrowser)(url);
    }
  } catch (e) {
    io.err(`opensymbols: ${describeError(e)}\n`);
    return { code: 2 };
  }
  if (options.wait === false) return { code: 0, handle };
  await new Promise<void>((done) => {
    process.once("SIGINT", () => done());
    process.once("SIGTERM", () => done());
  });
  await handle.close();
  return { code: 0 };
}
