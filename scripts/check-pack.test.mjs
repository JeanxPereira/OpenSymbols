import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTarballEntries, main } from './check-pack.mjs';

const entry = (path, content = '') => ({ path, content });

test('rejects symbol modules', () => {
  assert.notEqual(checkTarballEntries([entry('package/symbols/wifi.js')]).length, 0);
});
test('rejects symbol modules whatever the case', () => {
  assert.notEqual(checkTarballEntries([entry('package/Symbols/wifi.js')]).length, 0);
});
test('rejects chunk files', () => {
  assert.notEqual(checkTarballEntries([entry('package/chunks/0.json')]).length, 0);
});
test('rejects .plist', () => {
  assert.notEqual(checkTarballEntries([entry('package/x.plist')]).length, 0);
});
test('rejects .car, whatever the case', () => {
  assert.notEqual(checkTarballEntries([entry('package/x.car')]).length, 0);
  assert.notEqual(checkTarballEntries([entry('package/x.CAR')]).length, 0);
});
test('rejects colors-*.csv', () => {
  assert.notEqual(checkTarballEntries([entry('package/colors-2.csv')]).length, 0);
});
test('rejects JSON containing "masters"', () => {
  const errors = checkTarballEntries([entry('package/data.json', '{"masters":[]}')]);
  assert.notEqual(errors.length, 0);
});
test('rejects "masters" in any text file, not only lowercase .json', () => {
  for (const path of ['package/data.JSON', 'package/dist/index.js', 'package/x.txt']) {
    assert.notEqual(checkTarballEntries([entry(path, 'export default {"masters":[1]}')]).length, 0, path);
  }
});
test('rejects a long run of SVG path data in a published source', () => {
  const d = 'M0 0' + ' L1.5 2.25'.repeat(20) + 'Z';
  assert.notEqual(checkTarballEntries([entry('package/dist/index.js', `const p = "${d}";`)]).length, 0);
  assert.notEqual(checkTarballEntries([entry('package/dist/x.svg', `<path d="${d}"/>`)]).length, 0);
});
test('accepts short path data and ordinary code', () => {
  const code = 'const LETTERS = ["L", "C", "S"]; const ARITY = { M: 2, m: 2, C: 6 }; const d = "M0 0L1 1Z";';
  assert.deepEqual(checkTarballEntries([entry('package/dist/index.js', code)]), []);
});
test('reports a binary entry by path only', () => {
  assert.deepEqual(checkTarballEntries([{ path: 'package/dist/logo.png', content: null }]), []);
});
test('accepts a clean package', () => {
  assert.deepEqual(
    checkTarballEntries([entry('package/dist/index.js'), entry('package/README.md')]),
    [],
  );
});

/** A packages dir in os.tmpdir() holding one package whose files are `files`. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'opensymbols-pack-'));
  const pkg = join(root, 'pkg');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', files: ['dist', 'symbols'] }),
  );
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(pkg, path, '..'), { recursive: true });
    writeFileSync(join(pkg, path), content);
  }
  return root;
}

const quiet = { log() {}, error() {} };

test('main exits 1 on a package with a planted symbols/x.js', () => {
  const root = fixture({ 'dist/index.js': 'export {};\n', 'symbols/x.js': 'export {};\n' });
  try {
    assert.equal(main(root, quiet), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('main exits 0 on a clean package', () => {
  const root = fixture({ 'dist/index.js': 'export {};\n' });
  try {
    assert.equal(main(root, quiet), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
