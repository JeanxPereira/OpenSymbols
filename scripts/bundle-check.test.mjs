// Spec §9.3: a static-only app does not bundle the effects engine. Builds a tiny app that renders
// one generated-style icon, and asserts no engine code reached the output; a second build that
// registers the effects must contain it, which proves the markers detect the engine at all.
// Needs the packages built (root `pnpm test` runs `pnpm build` first).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// The entries resolve the workspace packages from the demo app, which depends on all three.
const resolveDir = join(root, 'apps', 'demo');

/**
 * Functions that exist only in `@opensymbols/animate` and that registering the effects reaches: the
 * drawing builder, the loop-cycle sampler and the stroke clip (not `useSymbolEffects`: `@opensymbols/react`
 * calls a method of that name). esbuild keeps top-level names when it does not minify.
 */
export const ENGINE_MARKERS = ['toAnimDrawing', 'cycleEnds', 'clipOutline'];

/** A minimal symbol in the format a generated module passes to `createIcon`. */
const SYMBOL = {
  v: 1,
  name: 'square',
  palette: 'stand-in',
  variants: {
    a0d0: {
      ops: 'MLLLZ',
      argCounts: [2, 2, 2, 2, 0],
      masters: { 4: { args: [0, 0, 10, 0, 10, 10, 0, 10], viewBox: [0, 0, 10, 10], transform: [1, 0, 0, 1, 0, 0] } },
      layers: [
        {
          cmd: [0, 5],
          role: 'primary',
          modes: Object.fromEntries(
            ['monochrome', 'hierarchical', 'multicolor', 'palette'].map((m) => [m, { paint: { kind: 'tint' }, opacity: 1, clearBehind: false }]),
          ),
          motionGroup: 0,
        },
      ],
      variableValueMode: 'color',
      vcContinuous: false,
    },
  },
  defaultVariant: 'a0d0',
  modes: ['monochrome'],
  build: { validated: false },
};

/** The icon module a generated package holds, followed by `extra` lines. */
const entry = (extra = '') => `import { createIcon } from "@opensymbols/react";
const Square = /*#__PURE__*/ createIcon(${JSON.stringify(SYMBOL)});
export default Square;
${extra}
`;

/** Bundles `contents` for the browser into a temporary directory and returns the JavaScript it wrote. */
async function bundle(contents) {
  const outdir = mkdtempSync(join(tmpdir(), 'opensymbols-bundle-'));
  try {
    await build({
      stdin: { contents, resolveDir, sourcefile: 'app.js', loader: 'js' },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      minify: false,
      // React itself is not under test; leaving it out keeps the output small and the build fast.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      outdir,
      logLevel: 'silent',
    });
    return readdirSync(outdir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(outdir, f), 'utf8'))
      .join('\n');
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

test('an app that only renders icons bundles no effects engine code', async () => {
  const out = await bundle(entry());
  assert.match(out, /function createIcon\b/, 'the icon runtime is in the bundle');
  for (const marker of ENGINE_MARKERS) {
    assert.ok(!out.includes(marker), `engine code "${marker}" reached a static-only bundle`);
  }
});

test('registering the effects brings the engine in (the markers detect it)', async () => {
  const out = await bundle(entry('import "@opensymbols/animate/react";'));
  for (const marker of ENGINE_MARKERS) {
    assert.ok(out.includes(marker), `"${marker}" is missing from a bundle that registers the effects`);
  }
});
