// Shared code for the kit's audit seal (CONVENTIONS §6).
//
// The seal (`.claude/kit-seal.json`) records, per file, the sha256 of the content that
// passed `/kit:audit`. `seal-write.mjs` writes it from the working tree right after a PASS;
// `seal-guard.mjs` (PreToolUse hook) compares it with the INDEX — what `git commit` will
// really record — and blocks the commit when a staged file is missing or changed.
//
// Text content is hashed with CRLF normalized to LF so that a file sealed from a Windows
// checkout (CRLF on disk) matches the LF blob git stores with `core.autocrlf`. Binary
// content (a NUL byte in the first 8000 bytes, git's own heuristic) is hashed as is.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const KIT_FILE = '.claude/kit.json';
export const SEAL_FILE = '.claude/kit-seal.json';
export const AUDIT_STATE_FILE = '.claude/kit-audit-state.json';
export const DELETED = 'deleted';

/** Files the kit writes itself: they are state, never audited, never sealed. */
export const KIT_STATE_FILES = new Set([SEAL_FILE, AUDIT_STATE_FILE]);

/** Refs that mark "the other side" of a merge, cherry-pick, revert or rebase. */
const OTHER_SIDE_REFS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD^', 'REBASE_HEAD'];

/** The well-known id of git's empty tree, used to diff an unborn branch. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Runs git in `dir`. `binary: true` returns a Buffer (the stdin text is sent as UTF-8). */
export function git(dir, args, { input, binary = false } = {}) {
  return execFileSync('git', ['-C', dir, ...args], {
    ...(binary ? {} : { encoding: 'utf8' }),
    input: input === undefined ? undefined : Buffer.from(input, 'utf8'),
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
}

/** Top-level folder of the repository that contains `dir`, or null outside a repo. */
export function repoRoot(dir) {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

/**
 * Reads `.claude/kit.json`. `state` is `absent`, `invalid` (unparsable) or `ok`.
 * The raw text is kept so an unparsable file that clearly opted in still counts.
 */
export function readKitConfig(root) {
  const file = join(root, KIT_FILE);
  if (!existsSync(file)) return { state: 'absent' };
  const raw = readFileSync(file, 'utf8');
  try {
    return { state: 'ok', config: JSON.parse(raw), raw };
  } catch {
    return { state: 'invalid', raw };
  }
}

/** True only when the project explicitly opted in with `"seal": true`. */
export function sealEnabled(kit) {
  if (kit.state === 'ok') return kit.config?.seal === true;
  if (kit.state === 'invalid') return /"seal"\s*:\s*true\b/.test(kit.raw);
  return false;
}

/** sha256 of a file's content, with text EOL normalized (see the header). */
export function contentHash(buffer) {
  const binary = buffer.subarray(0, 8000).includes(0);
  const data = binary
    ? buffer
    : Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha256').update(data).digest('hex');
}

/** Reads the seal; returns null when it is absent or unparsable. */
export function readSeal(root) {
  const file = join(root, SEAL_FILE);
  if (!existsSync(file)) return null;
  try {
    const seal = JSON.parse(readFileSync(file, 'utf8'));
    if (!seal || typeof seal !== 'object' || typeof seal.sha256 !== 'object') return null;
    return seal;
  } catch {
    return null;
  }
}

export function writeSeal(root, seal) {
  const file = join(root, SEAL_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(seal, null, 2)}\n`);
}

/** Splits NUL-separated git output into its non-empty parts. */
const nulList = (text) => text.split('\0').filter(Boolean);

/**
 * Staged changes as `{ path, status }`, renames split into delete + add. On an unborn
 * branch (first commit) the index is compared with the empty tree.
 */
export function stagedChanges(root) {
  let out;
  try {
    out = git(root, ['diff', '--cached', '--name-status', '-z', '--no-renames']);
  } catch {
    out = git(root, ['diff', '--cached', '--name-status', '-z', '--no-renames', EMPTY_TREE]);
  }
  const parts = nulList(out);
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changes.push({ status: parts[i], path: parts[i + 1] });
  }
  return changes;
}

/**
 * Index content of each path (stage 0) through one `git cat-file --batch`.
 * A path missing from the index maps to null.
 */
export function indexContents(root, paths) {
  const contents = new Map();
  if (paths.length === 0) return contents;
  const out = git(root, ['cat-file', '--batch'], {
    input: `${paths.map((p) => `:${p}`).join('\n')}\n`,
    binary: true,
  });
  let pos = 0;
  for (const path of paths) {
    const eol = out.indexOf(0x0a, pos);
    const header = out.subarray(pos, eol).toString('utf8');
    pos = eol + 1;
    if (header.endsWith(' missing')) {
      contents.set(path, null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    contents.set(path, out.subarray(pos, pos + size));
    pos += size + 1;
  }
  return contents;
}

/** Blob id per path in the index (`git ls-files -s`). */
function indexBlobIds(root) {
  const ids = new Map();
  for (const line of nulList(git(root, ['ls-files', '-s', '-z']))) {
    const tab = line.indexOf('\t');
    ids.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[1]);
  }
  return ids;
}

/** Blob id per path in a commit's tree. */
function treeBlobIds(root, ref) {
  const ids = new Map();
  for (const line of nulList(git(root, ['ls-tree', '-r', '-z', '--full-tree', ref]))) {
    const tab = line.indexOf('\t');
    const [, type, id] = line.slice(0, tab).split(' ');
    if (type === 'blob') ids.set(line.slice(tab + 1), id);
  }
  return ids;
}

/**
 * During a merge, cherry-pick, revert or rebase, a staged file that is byte-identical to
 * the other side was already audited where it came from; only the resolution needs a seal.
 */
function otherSides(root) {
  const sides = [];
  for (const ref of OTHER_SIDE_REFS) {
    try {
      git(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
      sides.push(treeBlobIds(root, ref));
    } catch {
      // the ref does not exist: no operation of that kind in progress
    }
  }
  return sides;
}

/**
 * What would enter the commit without a matching seal: `[{ path, reason }]`, where reason
 * is `no-seal`, `not-pass`, `not-sealed` or `changed`. Kit state files are ignored.
 */
export function unsealedStaged(root) {
  const staged = stagedChanges(root).filter((c) => !KIT_STATE_FILES.has(c.path));
  if (staged.length === 0) return [];

  const sides = otherSides(root);
  const blobIds = sides.length > 0 ? indexBlobIds(root) : null;
  const fromOtherSide = (path) =>
    blobIds !== null &&
    sides.some((side) => (side.get(path) ?? DELETED) === (blobIds.get(path) ?? DELETED));
  const changes = staged.filter((c) => !fromOtherSide(c.path));
  if (changes.length === 0) return [];

  const seal = readSeal(root);
  if (!seal) return changes.map((c) => ({ path: c.path, reason: 'no-seal' }));
  if (seal.verdict !== 'PASS') return changes.map((c) => ({ path: c.path, reason: 'not-pass' }));

  const present = changes.filter((c) => c.status !== 'D').map((c) => c.path);
  const contents = indexContents(root, present);
  const problems = [];
  for (const { path, status } of changes) {
    const content = status === 'D' ? null : contents.get(path);
    const actual = content == null ? DELETED : contentHash(content);
    const expected = seal.sha256[path];
    if (expected === actual) continue;
    problems.push({ path, reason: expected === undefined ? 'not-sealed' : 'changed' });
  }
  return problems;
}

const REASONS = {
  'no-seal': 'no .claude/kit-seal.json yet',
  'not-pass': 'the last seal is not a PASS',
  'not-sealed': 'not in the seal',
  changed: 'content changed after the seal',
};

const MAX_LISTED = 20;

/** The text the agent reads when the commit is blocked. */
export function blockedMessage(problems) {
  const listed = problems.slice(0, MAX_LISTED).map((p) => `  - ${p.path} (${REASONS[p.reason]})`);
  if (problems.length > MAX_LISTED) listed.push(`  ... and ${problems.length - MAX_LISTED} more`);
  return [
    'Commit blocked by the kit seal (.claude/kit.json has "seal": true).',
    `Staged files without a matching audit seal (${problems.length}):`,
    ...listed,
    '',
    'What to do:',
    '  1. Run /kit:audit on exactly the paths you are committing; on PASS it writes',
    '     .claude/kit-seal.json with their content hashes.',
    '  2. Fix what the auditors report, re-run the failed audits, then commit again',
    '     without editing anything in between.',
    '  3. If a staged file is not yours (another session staged it), unstage it and',
    '     commit only your paths.',
    'Never bypass this hook. To turn the seal off, set "seal": false in .claude/kit.json.',
  ].join('\n');
}
