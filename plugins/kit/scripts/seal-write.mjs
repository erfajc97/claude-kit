#!/usr/bin/env node
// Writes the audit seal (CONVENTIONS §6) after `/kit:audit` returned PASS.
//
//   node <kit>/scripts/seal-write.mjs -- <file> [<file> ...]
//   node <kit>/scripts/seal-write.mjs --add -- <file> ...   (merge into the current PASS seal)
//
// Run from inside the repository. Each path is a FILE that goes into the commit (deleted
// files are allowed and recorded as "deleted"); folders, globs and pathspec magic are
// refused, because the tree may be shared by several sessions and a broad seal would cover
// work nobody audited. Without `--add` the seal is replaced; `--add` is for files changed
// after the audit that need no audit of their own (the progress-log ticks of
// `/kit:phase-done`).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { contentHash, DELETED, git, KIT_STATE_FILES, readSeal, repoRoot, writeSeal } from './seal-lib.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Paths git knows (HEAD or index), to accept a deleted file only if it existed. */
function knownToGit(root, path) {
  try {
    git(root, ['cat-file', '-e', `:${path}`]);
    return true;
  } catch {
    try {
      git(root, ['cat-file', '-e', `HEAD:${path}`]);
      return true;
    } catch {
      return false;
    }
  }
}

export function sealPaths({ cwd, args, now = new Date() }) {
  const add = args.includes('--add');
  const dash = args.indexOf('--');
  const rest = dash === -1 ? args.filter((a) => a !== '--add') : args.slice(dash + 1);
  const before = dash === -1 ? [] : args.slice(0, dash).filter((a) => a !== '--add');
  if (before.length > 0) throw new Error(`Unknown option(s) before "--": ${before.join(' ')}`);
  if (rest.length === 0) throw new Error('Usage: seal-write.mjs [--add] -- <file> [<file> ...]');

  const root = repoRoot(cwd);
  if (!root) throw new Error('Not inside a git repository.');

  const sha256 = {};
  for (const input of rest) {
    if (input.startsWith(':') || /[*?[\]]/.test(input)) {
      throw new Error(`"${input}" is a pattern, not a file: pass the exact files of the commit.`);
    }
    const absolute = isAbsolute(input) ? input : resolve(cwd, input);
    const path = relative(root, absolute).replaceAll('\\', '/');
    if (!path || path.startsWith('..')) throw new Error(`"${input}" is outside the repository.`);
    if (KIT_STATE_FILES.has(path)) continue;
    if (existsSync(absolute)) {
      if (statSync(absolute).isDirectory()) {
        throw new Error(`"${input}" is a folder: pass the files of the commit, one by one.`);
      }
      sha256[path] = contentHash(readFileSync(absolute));
    } else if (knownToGit(root, path)) {
      sha256[path] = DELETED;
    } else {
      throw new Error(`"${input}" does not exist and git does not know it.`);
    }
  }

  let seal = { paths: [], sha256: {}, verdict: 'PASS', at: now.toISOString() };
  if (add) {
    const current = readSeal(root);
    if (!current || current.verdict !== 'PASS') {
      throw new Error('--add needs an existing PASS seal: run /kit:audit first.');
    }
    seal = { ...current, paths: [...current.paths], sha256: { ...current.sha256 }, at: now.toISOString() };
  }
  for (const [path, hash] of Object.entries(sha256)) {
    seal.sha256[path] = hash;
    if (!seal.paths.includes(path)) seal.paths.push(path);
  }
  seal.paths.sort();
  writeSeal(root, seal);
  return Object.keys(sha256);
}

const isEntryPoint = process.argv[1] && /seal-write\.mjs$/.test(process.argv[1]);
if (isEntryPoint) {
  try {
    const sealed = sealPaths({ cwd: process.cwd(), args: process.argv.slice(2) });
    process.stdout.write(`Kit seal: ${sealed.length} file(s) sealed in .claude/kit-seal.json\n`);
    for (const path of sealed) process.stdout.write(`  ${path}\n`);
  } catch (err) {
    fail(String(err?.message ?? err));
  }
}
