import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec §11: what must never be in a published tarball. Paths match whatever the case.
const FORBIDDEN_PATH = [
  [/(^|\/)symbols\//i, 'symbol modules'],
  [/(^|\/)chunks\//i, 'catalog chunks'],
  [/\.(plist|car|strings)$/i, 'Apple catalog file'],
  [/(^|\/)colors-[^/]*\.csv$/i, 'Apple color table'],
  [/(^|\/)base_symbols_map\.json$/i, 'Apple metadata file'],
  [/\.dump\.txt$/i, 'dump file'],
];

/** Spec §11: a run of this many path tokens (command letters and numbers) is drawing data. */
export const PATH_TOKEN_LIMIT = 40;

const CMD = '[MmLlCcSsQqTtHhVvZz]';
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
// A command letter followed by commands and numbers with optional separators. Nothing follows
// the greedy repetition, so the match never backtracks into it.
const PATH_RUN = new RegExp(`${CMD}(?:[\\s,]*(?:${CMD}|${NUM}))+`, 'g');
const PATH_TOKEN = new RegExp(`${CMD}|${NUM}`, 'g');
const NUMBER_TOKEN = new RegExp(`^${NUM}$`);

/** The longest run of SVG path data in `text`, counted in tokens, and its first characters. */
function longestPathRun(text) {
  let best = { tokens: 0, numbers: 0, sample: '' };
  for (const m of text.matchAll(PATH_RUN)) {
    if (m[0].length < PATH_TOKEN_LIMIT) continue;
    const tokens = m[0].match(PATH_TOKEN) ?? [];
    const numbers = tokens.filter((t) => NUMBER_TOKEN.test(t)).length;
    if (tokens.length > best.tokens) best = { tokens: tokens.length, numbers, sample: m[0].slice(0, 40) };
  }
  return best;
}

/**
 * @param {{path: string, content: string | null}[]} entries `content` is null for a binary file
 * @returns {string[]}
 */
export function checkTarballEntries(entries) {
  const errors = [];
  for (const { path, content } of entries) {
    for (const [re, what] of FORBIDDEN_PATH) {
      if (re.test(path)) errors.push(`${path}: forbidden ${what}`);
    }
    if (content === null) continue;
    if (content.includes('"masters"')) {
      errors.push(`${path}: contains "masters" (catalog data)`);
    }
    const run = longestPathRun(content);
    // Interleaved: at least as many numbers as a path's commands would need, not a word list.
    if (run.tokens >= PATH_TOKEN_LIMIT && run.numbers * 2 >= run.tokens) {
      errors.push(`${path}: SVG path data of ${run.tokens} tokens ("${run.sample}…")`);
    }
  }
  return errors;
}

/** A file is text unless it holds a NUL byte. */
function readEntry(file) {
  const bytes = readFileSync(file);
  return bytes.includes(0) ? null : bytes.toString('utf8');
}

function packPackage(dir) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const [info] = JSON.parse(out);
  const errors = [];
  const entries = [];
  for (const f of info.files) {
    const file = join(dir, f.path);
    if (!existsSync(file)) {
      errors.push(`package/${f.path}: listed by npm pack but missing on disk`);
      continue;
    }
    entries.push({ path: `package/${f.path}`, content: readEntry(file) });
  }
  return { entries, errors };
}

/** Packs every package under `pkgsDir` and checks it; returns the exit code. */
export function main(pkgsDir = join(resolve(fileURLToPath(import.meta.url), '..', '..'), 'packages'), log = console) {
  let failed = false;
  for (const name of readdirSync(pkgsDir)) {
    const dir = join(pkgsDir, name);
    if (!existsSync(join(dir, 'package.json'))) continue;
    const packed = packPackage(dir);
    const errors = [...packed.errors, ...checkTarballEntries(packed.entries)];
    for (const e of errors) log.error(`[${name}] ${e}`);
    if (errors.length) failed = true;
    else log.log(`[${name}] tarball clean`);
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exitCode = main();
