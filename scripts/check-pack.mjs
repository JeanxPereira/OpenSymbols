import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

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
  // --ignore-scripts: the caller has built already, and a package's own prepack runs this check.
  // Without pnpm's npm_config_* settings, which npm warns about when this runs in a prepack.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
  const out = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: dir, env, encoding: 'utf8' });
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

/** Packs the package in `dir` (a dry run) and checks it; returns its errors. */
export function checkPackage(dir) {
  const packed = packPackage(dir);
  return [...packed.errors, ...checkTarballEntries(packed.entries)];
}

/**
 * The entries of a .tgz written by `pnpm pack` or `npm pack` (ustar, gzip). Only regular files.
 * @returns {{path: string, content: string | null}[]}
 */
export function readTarball(file) {
  const tar = gunzipSync(readFileSync(file));
  const entries = [];
  const field = (at, len) => tar.subarray(at, at + len).toString('utf8').replace(/\0.*$/s, '');
  let longName = null;
  for (let pos = 0; pos + 512 <= tar.length; ) {
    const name = field(pos, 100);
    if (name === '') break;
    const size = parseInt(field(pos + 124, 12).trim() || '0', 8);
    const type = field(pos + 156, 1);
    const prefix = field(pos + 345, 155);
    const body = tar.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (type !== '0' && type !== '') continue;
    entries.push({ path, content: body.includes(0) ? null : body.toString('utf8') });
  }
  return entries;
}

/** Packs every package under `pkgsDir` and checks it; returns the exit code. */
export function main(pkgsDir = join(resolve(fileURLToPath(import.meta.url), '..', '..'), 'packages'), log = console) {
  let failed = false;
  for (const name of readdirSync(pkgsDir)) {
    const dir = join(pkgsDir, name);
    if (!existsSync(join(dir, 'package.json'))) continue;
    if (!report(name, checkPackage(dir), log)) failed = true;
  }
  return failed ? 1 : 0;
}

function report(name, errors, log) {
  for (const e of errors) log.error(`[${name}] ${e}`);
  if (errors.length === 0) log.log(`[${name}] tarball clean`);
  return errors.length === 0;
}

/** True when the running package manager is pnpm, from the `npm_config_user_agent` it sets. */
export function isPnpm(userAgent = process.env.npm_config_user_agent) {
  return typeof userAgent === 'string' && userAgent.startsWith('pnpm/');
}

const NOT_PNPM = `refusing to pack or publish with npm: the package.json holds "workspace:" ranges that only
pnpm rewrites into versions. Use pnpm instead: pnpm publish (or pnpm pack) in the package, or
pnpm -r publish at the repository root`;

/**
 * The command line: no option checks every package; `--package DIR` checks one package;
 * `--tarball FILE` checks a packed .tgz; `--require-pnpm` only checks the package manager.
 */
export function cli(args = process.argv.slice(2), log = console) {
  const { values } = parseArgs({
    args,
    options: {
      package: { type: 'string' },
      tarball: { type: 'string' },
      'require-pnpm': { type: 'boolean' },
    },
  });
  if (values['require-pnpm']) {
    if (isPnpm()) return 0;
    log.error(NOT_PNPM);
    return 1;
  }
  if (values.package !== undefined) {
    const dir = resolve(values.package);
    const { name } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return report(name, checkPackage(dir), log) ? 0 : 1;
  }
  if (values.tarball !== undefined) {
    return report(basename(values.tarball), checkTarballEntries(readTarball(values.tarball)), log) ? 0 : 1;
  }
  return main(undefined, log);
}

if (import.meta.main) process.exitCode = cli();
