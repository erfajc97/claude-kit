#!/usr/bin/env node
// PreToolUse hook (Bash / PowerShell) of the kit plugin — the opt-in audit seal
// (CONVENTIONS §6).
//
// Reads the hook payload from stdin. When the command runs `git commit` in a repository
// whose `.claude/kit.json` has `"seal": true`, every staged file must match
// `.claude/kit-seal.json` (sha256 of the content that passed `/kit:audit`); otherwise the
// hook exits 2 and Claude Code shows the agent the reason on stderr.
//
// It is a strict no-op (exit 0, no output) for every other command and for every project
// without `kit.json` or with `"seal": false`: the plugin is installed machine-wide and must
// never affect a project that did not opt in.
//
// Limits (stated, not hidden): the hook sees the command BEFORE it runs, so staging and
// committing in one command (`git add x && git commit`, `git commit -a`, `git commit -- x`)
// is refused when the seal is on — stage first, then commit in a separate command. It reads
// literal folders only (`cd <dir>`, `git -C <dir>`); a folder held in a variable falls back
// to the session folder.

import { isAbsolute, resolve } from 'node:path';
import { blockedMessage, readKitConfig, repoRoot, sealEnabled, unsealedStaged } from './seal-lib.mjs';

/** Cheap pre-filter: nothing without these words is even parsed. */
const MAY_COMMIT = /\bcommit\b|commit-tree/;

/** Options of `git commit` whose value may come as the next token. */
const COMMIT_VALUE_OPTIONS = new Set([
  '-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date', '--template',
  '--reuse-message', '--reedit-message', '--fixup', '--squash', '--cleanup', '--trailer',
]);
/** Short letters whose value is the rest of the cluster or, if none, the next token. */
const SHORT_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);
/** Short letters whose optional value can only be attached (`-uno`, `-S<keyid>`). */
const SHORT_ATTACHED_VALUE = new Set(['u', 'S']);
/** Short letters that make `git commit` stage by itself. */
const SHORT_STAGING = new Set(['a', 'i', 'o', 'p']);
const LONG_STAGING = new Set([
  '--all', '--include', '--only', '--patch', '--interactive', '--pathspec-from-file',
]);
/** Other git subcommands that change the index. */
const INDEX_WRITERS = new Set([
  'add', 'stage', 'rm', 'mv', 'update-index', 'apply', 'restore', 'reset', 'read-tree',
]);
const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n']);

/**
 * Splits a shell command into tokens, honouring single/double quotes and (in bash)
 * backslash escapes, and emitting separators (`&&`, `||`, `;`, `|`, `&`, newline) as their
 * own tokens. PowerShell has no backslash escape, so Windows paths survive as written. It
 * never evaluates anything.
 */
export function tokenize(command, { shell = 'bash' } = {}) {
  const bash = shell === 'bash';
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  const push = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (bash && c === '\\' && quote === '"' && '$`"\\\n'.includes(command[i + 1] ?? '')) {
        current += command[++i];
      } else current += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (bash && c === '\\' && i + 1 < command.length && command[i + 1] !== '\n') {
      current += command[++i];
      started = true;
      continue;
    }
    if (c === '\n' || c === ';') {
      push();
      tokens.push(c);
      continue;
    }
    if (c === '&' || c === '|') {
      push();
      if (command[i + 1] === c) {
        tokens.push(c + c);
        i++;
      } else tokens.push(c);
      continue;
    }
    if (c === '(' || c === ')' || c === '{' || c === '}') {
      push();
      continue;
    }
    if (/\s/.test(c)) {
      push();
      continue;
    }
    current += c;
    started = true;
  }
  push();
  return tokens;
}

const isGit = (token) => /(^|[\\/])git(\.exe)?$/i.test(token);

/**
 * Every git invocation in the command: `{ dir, sub, args }`, where `dir` is the literal
 * `-C` folder (or the folder of the last literal `cd`/`Set-Location`/`pushd`, or null) and
 * `args` are the tokens after the subcommand up to the next separator.
 */
export function gitInvocations(command, { shell = 'bash' } = {}) {
  const tokens = tokenize(command, { shell });
  const calls = [];
  let cdDir = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(cd|set-location|sl|pushd|chdir)$/i.test(t) && tokens[i + 1] && !SEPARATORS.has(tokens[i + 1])) {
      let target = tokens[i + 1];
      if (/^-(path|literalpath)$/i.test(target) && tokens[i + 2]) target = tokens[i + 2];
      target = nativePath(target);
      cdDir = cdDir && !isAbsolute(target) ? resolve(cdDir, target) : target;
      continue;
    }
    if (!isGit(t)) continue;
    let dir = cdDir;
    let j = i + 1;
    while (j < tokens.length && tokens[j].startsWith('-')) {
      const opt = tokens[j];
      if (opt === '-C' && tokens[j + 1]) {
        const target = nativePath(tokens[j + 1]);
        dir = dir && !isAbsolute(target) ? resolve(dir, target) : target;
        j += 2;
      } else if (opt === '-c' || opt === '--git-dir' || opt === '--work-tree' || opt === '--namespace') {
        j += 2;
      } else j += 1;
    }
    const sub = tokens[j];
    if (!sub || SEPARATORS.has(sub)) continue;
    const args = [];
    for (let k = j + 1; k < tokens.length && !SEPARATORS.has(tokens[k]); k++) args.push(tokens[k]);
    calls.push({ dir, sub, args });
  }
  return calls;
}

/** True when `git commit` itself would stage files (`-a`, `--only`, pathspecs…). */
export function commitStagesItself(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^[<>]|^\d>/.test(a)) break; // redirection or heredoc: the rest is not arguments
    if (a === '--') return i + 1 < args.length;
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      if (LONG_STAGING.has(name)) return true;
      if (COMMIT_VALUE_OPTIONS.has(a)) i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      if (COMMIT_VALUE_OPTIONS.has(a)) {
        i++;
        continue;
      }
      const letters = a.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const letter = letters[k];
        if (SHORT_STAGING.has(letter)) return true;
        if (SHORT_ATTACHED_VALUE.has(letter)) break; // the rest of the cluster is its value
        if (SHORT_WITH_VALUE.has(letter)) {
          if (k === letters.length - 1) i++; // no attached value: it is the next token
          break;
        }
      }
      continue;
    }
    return true; // a bare word after the options is a pathspec
  }
  return false;
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Git Bash spells `C:\x` as `/c/x`; Node on Windows needs the drive form. */
function nativePath(path) {
  if (process.platform !== 'win32') return path;
  const msys = /^\/([a-zA-Z])(\/|$)/.exec(path);
  return msys ? `${msys[1]}:/${path.slice(3)}` : path;
}

class Blocked extends Error {}

function block(lines) {
  throw new Blocked(Array.isArray(lines) ? lines.join('\n') : lines);
}

/** Set once a commit targets an opted-in repo: only then may a failure block. */
let optedIn = false;

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return; // not a hook payload: nothing to guard
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || !MAY_COMMIT.test(command)) return;

  const shell = payload.tool_name === 'PowerShell' ? 'powershell' : 'bash';
  const calls = gitInvocations(command, { shell });
  const commits = calls.filter((c) => c.sub === 'commit' || c.sub === 'commit-tree');
  if (commits.length === 0) return;

  const sessionDir = nativePath(
    typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd(),
  );
  for (const commit of commits) {
    const literal = commit.dir && !/[$%`]/.test(commit.dir);
    const dir = literal ? resolve(sessionDir, nativePath(commit.dir)) : sessionDir;
    const root = repoRoot(dir);
    if (!root) continue;
    const kit = readKitConfig(root);
    if (!sealEnabled(kit)) continue;
    optedIn = true;

    if (kit.state === 'invalid') {
      block('Commit blocked: .claude/kit.json is not valid JSON, so the audit seal cannot be read. Fix the file first.');
    }
    if (commit.dir && !literal) {
      block('Commit blocked by the kit seal: the commit folder is held in a variable. Use a literal path (or run the commit from the repo folder).');
    }
    if (commit.sub === 'commit-tree') {
      block('Commit blocked by the kit seal: `git commit-tree` skips the seal check. Use `git commit`.');
    }
    const stagingCalls = calls.filter((c) => INDEX_WRITERS.has(c.sub));
    if (stagingCalls.length > 0 || commitStagesItself(commit.args)) {
      block([
        'Commit blocked by the kit seal: this command stages files and commits in one step,',
        'so the seal cannot be checked against what will really be committed.',
        'Stage first in its own command (`git add -- <paths>`), then run `git commit -F <file>`',
        'alone (no -a, no --only, no paths after commit).',
      ]);
    }
    const problems = unsealedStaged(root);
    if (problems.length > 0) block(blockedMessage(problems));
  }
}

const isEntryPoint = process.argv[1] && /seal-guard\.mjs$/.test(process.argv[1]);
if (isEntryPoint) {
  main().then(
    () => process.exit(0),
    (err) => {
      if (err instanceof Blocked) {
        process.stderr.write(`${err.message}\n`);
        process.exit(2);
      }
      // An unexpected failure blocks only a commit in a repo that opted in (failing open
      // there would let unaudited code through); everywhere else the hook stays silent.
      if (optedIn) {
        process.stderr.write(`Commit blocked: the kit seal guard failed (${err?.message ?? err}).\n`);
        process.exit(2);
      }
      process.exit(0);
    },
  );
}
