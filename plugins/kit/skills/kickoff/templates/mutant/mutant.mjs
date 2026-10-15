#!/usr/bin/env node
// One mutant of the G3 mutation check, run safely, on any OS (node only, no dependencies).
//
//   node .claude/kit/mutant/mutant.mjs --cwd <scope path> --file <path from cwd> \
//     --from '<exact snippet>' --to '<mutated snippet>' [--mode vitest|copy] [--base <config>] \
//     -- <test command...>
//
// --mode vitest (default): in memory. Installs vitest.mutant.config.mts into
//   <cwd>/node_modules/.kit-mutant/ (with `--base`, importing that config instead of
//   vitest.config.ts) and runs the command with MUTANT_FILE / MUTANT_FROM / MUTANT_TO set.
//   The command must pass `--config node_modules/.kit-mutant/vitest.mutant.config.mts`.
// --mode copy (fallback for Jest, pytest or any runner without transforms): backs the file
//   up to the temp dir, writes the mutant, runs the command, ALWAYS rewrites the original
//   (retrying on Windows file locks) and verifies its sha256. Use it only when no dev server
//   or other agent is reading that file, and say so in the report. KILLED is read from the
//   runner's summary: Vitest/Jest `Tests: N failed`, pytest `N failed … in 0.42s`, or an
//   AssertionError.
//
// Both modes compare the file's sha256 before and after. Exit: 0 KILLED, 1 SURVIVED,
// 2 INVALID (the mutant never ran or broke the build), 3 the source changed (restore it
// from the printed backup NOW).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export function parseArgs(argv) {
  const options = { cwd: '.', mode: 'vitest', base: null, command: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      options.command = argv.slice(i + 1);
      break;
    }
    const value = argv[i + 1];
    if (a === '--cwd') options.cwd = value;
    else if (a === '--file') options.file = value;
    else if (a === '--from') options.from = value;
    else if (a === '--to') options.to = value;
    else if (a === '--mode') options.mode = value;
    else if (a === '--base') options.base = value;
    else throw new Error(`unknown option ${a}`);
    i++;
  }
  if (!options.file || options.from === undefined || options.to === undefined) {
    throw new Error('--file, --from and --to are required');
  }
  if (!['vitest', 'copy'].includes(options.mode)) throw new Error('--mode is vitest or copy');
  if (options.command.length === 0) throw new Error('the test command goes after --');
  return options;
}

/**
 * A failing test in the runner's summary: Vitest (`Tests  1 failed | 2 passed`), Jest
 * (`Tests:  1 failed, 2 passed`), pytest (`1 failed, 2 passed in 0.42s`; a collection error
 * prints `1 error in …`, which is not a failing test) or a bare AssertionError.
 */
const FAILED_TEST = /Tests:?\s+\d+ failed|AssertionError|\b\d+ failed\b[^\n]*\bin \d+(\.\d+)?s\b/;

/** Classifies one run. KILLED needs a failing TEST, not just a non-zero exit. */
export function classify({ mode, status, output }) {
  if (mode === 'vitest') {
    if (/snippet must occur exactly once/.test(output)) {
      return { result: 'INVALID', reason: 'the snippet is not in the file exactly once' };
    }
    if (!output.includes('[kit-mutant] applied')) {
      return { result: 'INVALID', reason: 'the mutant was never applied: the specs run do not import that file' };
    }
  }
  if (status === 0) return { result: 'SURVIVED', reason: 'every test passed with the mutant: fix the TEST (G3)' };
  if (FAILED_TEST.test(output)) return { result: 'KILLED', reason: 'a test failed' };
  return { result: 'INVALID', reason: 'the run failed without a failing test (syntax, transform or setup error)' };
}

const quote = (arg) => (/^[\w./:=@%+,-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`);

function run(command, cwd, env) {
  const r = spawnSync(command.map(quote).join(' '), {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** Rewrites the original, retrying while Windows keeps the file locked. */
function restore(path, original) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      writeFileSync(path, original);
      if (sha256(readFileSync(path)) === sha256(original)) return true;
    } catch {
      // locked by a watcher or the runner: wait and retry
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return false;
}

export function mutate(options) {
  const cwd = resolve(options.cwd);
  const target = join(cwd, options.file);
  if (!existsSync(target)) throw new Error(`${options.file} does not exist under ${cwd}`);
  const original = readFileSync(target);
  const before = sha256(original);
  const backup = join(mkdtempSync(join(tmpdir(), 'kit-mutant-')), 'original');
  copyFileSync(target, backup);

  let outcome;
  if (options.mode === 'vitest') {
    const dir = join(cwd, 'node_modules', '.kit-mutant');
    mkdirSync(dir, { recursive: true });
    let config = readFileSync(join(HERE, 'vitest.mutant.config.mts'), 'utf8');
    if (options.base) config = config.replace("'../../vitest.config.ts'", `'../../${options.base.replaceAll('\\', '/')}'`);
    writeFileSync(join(dir, 'vitest.mutant.config.mts'), config);
    const { status, output } = run(options.command, cwd, {
      MUTANT_FILE: options.file.replaceAll('\\', '/'),
      MUTANT_FROM: options.from,
      MUTANT_TO: options.to,
    });
    outcome = { ...classify({ mode: 'vitest', status, output }), output };
  } else {
    const parts = original.toString('utf8').split(options.from);
    if (parts.length !== 2) {
      return { result: 'INVALID', reason: `the snippet occurs ${parts.length - 1} times (needs exactly 1)`, backup, intact: true };
    }
    let status;
    let output;
    try {
      writeFileSync(target, parts.join(options.to));
      ({ status, output } = run(options.command, cwd, {}));
    } finally {
      restore(target, original);
    }
    outcome = { ...classify({ mode: 'copy', status, output }), output };
  }
  const intact = sha256(readFileSync(target)) === before;
  return { ...outcome, backup, intact };
}

const isEntryPoint = process.argv[1] && /mutant\.mjs$/.test(process.argv[1]);
if (isEntryPoint) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const outcome = mutate(options);
    if (!outcome.intact) {
      process.stderr.write(
        `SOURCE CHANGED: ${options.file} is not byte-identical to before the run.\n` +
          `Restore it now: copy ${outcome.backup} over it, then check its sha256.\n`,
      );
      process.exit(3);
    }
    if (outcome.result === 'INVALID' && outcome.output) process.stdout.write(outcome.output.slice(-4000));
    process.stdout.write(`${outcome.result}  ${options.file}  '${options.from}' -> '${options.to}'  (${outcome.reason}; sha256 unchanged)\n`);
    process.exit({ KILLED: 0, SURVIVED: 1, INVALID: 2 }[outcome.result]);
  } catch (err) {
    process.stderr.write(`mutant.mjs: ${err?.message ?? err}\n`);
    process.exit(2);
  }
}
