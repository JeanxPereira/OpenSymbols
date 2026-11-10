import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FORMAT_VERSION } from '../packages/core/dist/index.js';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts', 'synthetic-package.mjs');
// Inside the workspace, so the generated modules resolve @opensymbols/react and react.
const base = mkdtempSync(join(root, 'packages', 'cli', '.generated-test-synthetic-'));
const run = (...args) =>
  execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const read = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

test.after(() => rmSync(base, { recursive: true, force: true }));

test('the packages are built (run pnpm build first)', () => {
  assert.ok(existsSync(join(root, 'packages', 'cli', 'dist', 'generate', 'assemble.js')), 'run pnpm build first');
});

const out = join(base, 'a');
test('300 symbols across 2 chunks, flagged as stand-in and unvalidated', () => {
  run('--out', out, '--count', '300');
  const index = read(out, 'index.json');
  assert.equal(index.symbols.length, 300);
  assert.equal(index.formatVersion, FORMAT_VERSION);
  assert.equal(index.palette, 'stand-in');
  assert.equal(index.build.validated, false);
  assert.deepEqual(index.build, { coreuiVersion: 1010, renditionCount: 900, facetCount: 300, validated: false });
  assert.deepEqual(readdirSync(join(out, 'chunks')).sort(), ['0.json', '1.json']);
  assert.equal(read(out, 'chunks', '1.json').length, 100);
  assert.equal(index.symbols[299].chunk, 1);
  for (const s of index.symbols) {
    assert.ok(s.approximate.includes('build') && s.approximate.includes('palette'));
  }
  assert.equal(new Set(index.symbols.map((s) => s.name)).size, 300);
  assert.equal(new Set(index.symbols.map((s) => s.component.toLowerCase())).size, 300);
});

test('12 categories with counts and search terms; the feature mix is present', () => {
  const index = read(out, 'index.json');
  assert.equal(index.categories.length, 12);
  assert.ok(index.categories.every((c) => c.count > 0 && c.label.length > 0));
  assert.ok(index.symbols.every((s) => s.categories.length > 0 && s.searchTerms.length > 0));
  assert.ok(index.symbols.some((s) => s.variableValue));
  assert.ok(index.symbols.some((s) => !s.variableValue));
  const chunk = [...read(out, 'chunks', '0.json'), ...read(out, 'chunks', '1.json')];
  assert.ok(chunk.every((s) => s.palette === 'stand-in' && s.build.validated === false));
  assert.ok(chunk.some((s) => Object.keys(s.variants).some((k) => k.endsWith('d4'))));
  assert.ok(chunk.some((s) => Object.keys(s.variants).some((k) => k.startsWith('a1'))));
  assert.ok(
    chunk.some((s) => Object.values(s.variants).some((v) => v.layers.some((l) => l.modes.monochrome.clearBehind))),
  );
  for (const s of chunk) {
    for (const v of Object.values(s.variants)) {
      assert.deepEqual(Object.keys(v.masters).sort(), ['1', '4', '9']);
      const n = v.masters[4].args.length;
      assert.ok(Object.values(v.masters).every((m) => m.args.length === n));
      assert.ok(Math.abs(v.masters[4].transform[0] - 0.0068) < 0.001);
    }
  }
});

test('the format carries what effects need: anchors, motion groups, stroke keyframes', () => {
  const chunk = [...read(out, 'chunks', '0.json'), ...read(out, 'chunks', '1.json')];
  const variants = chunk.flatMap((s) => Object.values(s.variants));
  const anchored = chunk.filter((s) => Object.values(s.variants).every((v) => v.masters[4].rotationAnchor));
  assert.ok(anchored.length > 60 && anchored.length < 120, `~30% anchored, got ${anchored.length}`);
  for (const v of variants) {
    for (const m of Object.values(v.masters)) {
      assert.equal(m.metricCenter.length, 2);
      assert.ok(m.metricCenter.every(Number.isFinite));
      if (m.rotationAnchor) assert.ok(m.rotationAnchor.every(Number.isFinite));
    }
    for (const l of v.layers) assert.ok(l.motionGroup >= 1 && l.motionGroup <= 4);
  }
  const groups = new Set(variants.flatMap((v) => v.layers.map((l) => l.motionGroup)));
  assert.deepEqual([...groups].sort(), [1, 2, 3, 4]);
  const reverses = chunk.filter((s) => Object.values(s.variants).every((v) => v.anim.drawReversesMotionGroups));
  assert.ok(reverses.length > 100 && reverses.length < 200, `about half reverse, got ${reverses.length}`);
  // 08 section 1 / 06 section 6.1: records {flags, progress, d0, d1}, a progress-0 and a progress-1 one,
  // d = subpath + fraction with the subpath inside the layer.
  let keyframed = 0;
  for (const v of variants) {
    for (const l of v.layers) {
      const kf = l.anim?.strokeKeyframes ?? [];
      if (kf.length === 0) continue;
      keyframed++;
      const subpaths = v.ops.slice(l.cmd[0], l.cmd[1]).split('M').length - 1;
      assert.ok(kf.some((k) => k.progress === 0) && kf.some((k) => k.progress === 1));
      for (const k of kf) {
        assert.ok(Number.isInteger(k.flags) && k.flags >= 0);
        assert.ok(k.progress >= 0 && k.progress <= 1);
        for (const d of [k.d0, k.d1]) assert.ok(d >= 0 && Math.floor(d) < subpaths, `d ${d} of ${subpaths}`);
      }
    }
  }
  assert.ok(keyframed > 100, `stroke keyframes on the bars and rings, got ${keyframed}`);
});

test('the modules render through react-dom/server', async () => {
  const require = createRequire(join(root, 'packages', 'cli', 'package.json'));
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const index = read(out, 'index.json');
  for (const s of index.symbols) {
    const C = (await import(pathToFileURL(join(out, 'symbols', `${s.component}.js`)).href)).default;
    for (const weight of ['ultralight', 'regular', 'black']) {
      assert.match(renderToStaticMarkup(createElement(C, { weight, mode: 'multicolor' })), /<svg/);
    }
    assert.match(renderToStaticMarkup(createElement(C, { variableValue: 0.5 })), /<svg/);
  }
});

test('the same seed gives the same package; another seed another', () => {
  run('--out', join(base, 'b'), '--count', '40', '--seed', '7');
  run('--out', join(base, 'c'), '--count', '40', '--seed', '7');
  run('--out', join(base, 'd'), '--count', '40', '--seed', '8');
  const text = (d) => readFileSync(join(base, d, 'chunks', '0.json'), 'utf8');
  assert.equal(text('b'), text('c'));
  assert.notEqual(text('b'), text('d'));
  const index = (d) => readFileSync(join(base, d, 'index.json'), 'utf8');
  assert.equal(index('b'), index('c'));
  assert.notEqual(index('b'), index('d'));
});

test('usage errors exit non-zero', () => {
  assert.throws(() => run('--count', '5'), (e) => /--out/.test(e.stderr));
  assert.throws(() => run('--out', join(base, 'e'), '--count', 'x'), (e) => /--count/.test(e.stderr));
});
