import { FORMAT_VERSION } from "@opensymbols/core";
import { describe, expect, it } from "vitest";
import { loadIndex } from "../../src/data/index-model.js";

function fakeFetch(status: number, body: unknown, seen: string[] = []): typeof fetch {
  return (async (url: string) => {
    seen.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("loadIndex", () => {
  it("loads <base>/index.json whatever the trailing slash", async () => {
    const seen: string[] = [];
    const body = { formatVersion: FORMAT_VERSION, symbols: [] };
    await loadIndex("/pkg", fakeFetch(200, body, seen));
    await loadIndex("/pkg/", fakeFetch(200, body, seen));
    expect(seen).toEqual(["/pkg/index.json", "/pkg/index.json"]);
  });

  it("rejects a non-200 with the status and URL", async () => {
    await expect(loadIndex("/pkg", fakeFetch(404, {}))).rejects.toThrow(/404.*\/pkg\/index\.json|\/pkg\/index\.json.*404/);
  });

  it("rejects a package newer than the demo", async () => {
    await expect(loadIndex("/pkg", fakeFetch(200, { formatVersion: FORMAT_VERSION + 1 }))).rejects.toThrow(
      /newer than the demo/,
    );
  });
});
