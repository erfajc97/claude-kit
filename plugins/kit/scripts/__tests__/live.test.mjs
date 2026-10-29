// node --test plugins/kit/scripts/__tests__/live.test.mjs
//
// The live session helper decides what a reviewer sees in `git status`, which files the
// auditors diff against and whether the plan still fits the clock, so it is tested against
// real git repositories in the system temp dir (never inside this repo).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detect } from '../live.mjs';

const LIVE = join(dirname(fileURLToPath(import.meta.url)), '..', 'live.mjs');
const ARCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'arch-check.mjs');
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

function write(cwd, path, text) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-live-'));
  dirs.push(dir);
  return dir;
}

const NODE_FILES = { 'package.json': '{"scripts":{"test":"vitest run","lint":"eslint ."}}', 'pnpm-lock.yaml': '' };

function makeRepo(files = NODE_FILES, { commit = true } = {}) {
  const repo = tmp();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  for (const [path, text] of Object.entries(files)) write(repo, path, text);
  if (commit) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'baseline');
  }
  return repo;
}

function live(cwd, ...args) {
  const run = spawnSync(process.execPath, [LIVE, ...args], { cwd, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    // status and changed print plain text
  }
  return { code: run.status, text: run.stdout, json };
}

const PLAN = ['# Plan', '', '| ID | Step | First test(s) | Est | Status |', '|---|---|---|---|---|', '| S1 | list | `lists` | 8 | ⬜ |', '| S2 | cancel | `cancels` | 10 | ⬜ |', '| S3 | page | `pages` | 12 | ⬜ |', ''].join('\n');

describe('live.mjs init', () => {
  it('exits 3 outside a git repository', () => {
    const run = live(tmp(), 'init');
    assert.equal(run.code, 3);
    assert.equal(run.json.error, 'not-a-git-repo');
  });

  it('exits 4 when the repository has no commit', () => {
    assert.equal(live(makeRepo({ 'a.txt': 'x' }, { commit: false }), 'init').code, 4);
  });

  it('records the baseline, hides its files from git and writes a live kit.json', () => {
    const repo = makeRepo();
    const run = live(repo, 'init', '--budget', '45', '--lang', 'en');
    assert.equal(run.code, 0);
    assert.equal(run.json.baseSha, git(repo, 'rev-parse', 'HEAD').trim());
    assert.equal(run.json.budgetMin, 45);
    assert.equal(run.json.commands.test, 'pnpm test');
    assert.equal(run.json.commands.lint, 'pnpm lint');
    const kit = JSON.parse(readFileSync(join(repo, '.claude', 'kit.json'), 'utf8'));
    assert.equal(kit.profile, 'live');
    assert.equal(kit.scopes.app.mode, 'report');
    assert.equal(kit.commands.app.test, 'pnpm test');
    assert.match(readFileSync(join(repo, '.live', 'rules.md'), 'utf8'), /kit:block live/);
    assert.equal(git(repo, 'status', '--porcelain').trim(), '', 'the kit files must be invisible to git');
    assert.equal(existsSync(join(repo, '.gitignore')), false, 'the repository .gitignore is never created or touched');
  });

  it('resumes instead of moving the baseline', () => {
    const repo = makeRepo();
    const first = live(repo, 'init').json;
    write(repo, 'src/new.js', 'export {};\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'step');
    const again = live(repo, 'init');
    assert.equal(again.json.resumed, true);
    assert.equal(again.json.baseSha, first.baseSha);
    assert.notEqual(git(repo, 'rev-parse', 'HEAD').trim(), first.baseSha);
  });

  it('leaves an existing kit.json that is not a live profile untouched', () => {
    const repo = makeRepo({ 'package.json': '{}', '.claude/kit.json': '{"profile":"other"}' });
    const run = live(repo, 'init');
    assert.equal(run.code, 0);
    assert.equal(run.json.kitJson, false);
    assert.equal(readFileSync(join(repo, '.claude', 'kit.json'), 'utf8'), '{"profile":"other"}');
  });
});

describe('live.mjs changed', () => {
  it('lists committed, edited and untracked files since the baseline and never .live', () => {
    const repo = makeRepo({ 'package.json': '{}', 'src/a.js': 'a\n' });
    live(repo, 'init');
    write(repo, 'src/b.js', 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'b');
    write(repo, 'src/a.js', 'a2\n');
    write(repo, 'src/c.js', 'c\n');
    assert.deepEqual(live(repo, 'changed').text.trim().split(/\r?\n/), ['src/a.js', 'src/b.js', 'src/c.js']);
    assert.equal(live(repo, 'changed', '--json').json.baseSha, git(repo, 'rev-parse', 'HEAD~1').trim());
  });
});

describe('live.mjs step and status', () => {
  it('rewrites only the status cell of its row and reports progress', () => {
    const repo = makeRepo();
    live(repo, 'init');
    write(repo, '.live/plan.md', PLAN);
    assert.equal(live(repo, 'step', 'S1', 'done', '--commit', 'abc1234').code, 0);
    assert.equal(live(repo, 'step', 'S2', 'doing').code, 0);
    const plan = readFileSync(join(repo, '.live', 'plan.md'), 'utf8');
    assert.match(plan, /\| S1 \| list \| `lists` \| 8 \| ✅ \|/);
    assert.match(plan, /\| S2 \| cancel \| `cancels` \| 10 \| 🔄 \|/);
    assert.match(plan, /\| S3 \| page \| `pages` \| 12 \| ⬜ \|/);
    const status = live(repo, 'status', '--json').json;
    assert.deepEqual(status.steps, { total: 3, done: 1, open: 2, current: 'S2', pendingEst: 22 });
    assert.equal(status.next, '/kit:live-step');
    live(repo, 'step', 'S2', 'done');
    live(repo, 'step', 'S3', 'parked');
    assert.equal(live(repo, 'status', '--json').json.next, '/kit:live-audit');
  });

  it('flags a plan that does not fit the time left', () => {
    const repo = makeRepo();
    live(repo, 'init', '--budget', '60');
    write(repo, '.live/plan.md', PLAN);
    const file = join(repo, '.live', 'state.json');
    const state = JSON.parse(readFileSync(file, 'utf8'));
    state.startedAt = new Date(Date.now() - 50 * 60000).toISOString();
    writeFileSync(file, JSON.stringify(state));
    const status = live(repo, 'status', '--json').json;
    assert.equal(status.elapsed, 50);
    assert.equal(status.overBudget, true);
    assert.match(live(repo, 'status').text, /⚠/);
  });

  it('answers a missing plan with 6 and an unknown step with 7', () => {
    const repo = makeRepo();
    live(repo, 'init');
    assert.equal(live(repo, 'step', 'S1', 'done').code, 6);
    write(repo, '.live/plan.md', PLAN);
    assert.equal(live(repo, 'step', 'S9', 'done').code, 7);
  });

  it('suggests the next command from the phase', () => {
    const repo = makeRepo();
    assert.equal(live(repo, 'status').code, 5, 'not initialised yet');
    live(repo, 'init');
    assert.equal(live(repo, 'status', '--json').json.next, '/kit:live-map');
    live(repo, 'phase', 'map');
    assert.equal(live(repo, 'status', '--json').json.next, '/kit:live-plan');
    live(repo, 'phase', 'audit');
    assert.equal(live(repo, 'status', '--json').json.next, '/kit:live-wrap');
    assert.equal(live(repo, 'phase', 'nonsense').code, 2);
  });
});

describe('live.mjs notes', () => {
  it('appends timestamped decisions and parked lines', () => {
    const repo = makeRepo();
    live(repo, 'init');
    live(repo, 'decide', 'cap the page size?', 'yes, 100');
    live(repo, 'decide', 'which auth?', 'header', '--assumed');
    live(repo, 'park', 'extract the pricing module');
    const decisions = readFileSync(join(repo, '.live', 'decisions.md'), 'utf8');
    assert.match(decisions, /- \[\d\d:\d\d\] Q: cap the page size\? → A: yes, 100 \(user\)/);
    assert.match(decisions, /Q: which auth\? → A: header \(assumed\)/);
    assert.match(readFileSync(join(repo, '.live', 'parked.md'), 'utf8'), /- \[\d\d:\d\d\] extract the pricing module/);
  });
});

describe('arch-check in a live repository', () => {
  const arch = (repo, baseSha) => spawnSync(process.execPath, [ARCH, '--base', baseSha], { cwd: repo, encoding: 'utf8' });

  it('counts a secret added by the candidate even though the scope is report', () => {
    const repo = makeRepo({ 'package.json': '{}', 'src/a.js': 'export const a = 1;\n' });
    const { baseSha } = live(repo, 'init').json;
    write(repo, 'src/b.js', 'export const key = "sk_live_abcdefghijklmnop";\n');
    const run = arch(repo, baseSha);
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /changed files/);
    assert.match(run.stdout, /\| BLOCKER \| G9 \| src\/b\.js:1/);
  });

  it('keeps findings on lines that already existed as pre-existing', () => {
    const repo = makeRepo({ 'package.json': '{}', 'src/a.js': '// TODO: old\nexport const a = 1;\n' });
    const { baseSha } = live(repo, 'init').json;
    write(repo, 'src/a.js', '// TODO: old\nexport const a = 2;\n');
    const run = arch(repo, baseSha);
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /Pre-existing[\s\S]*src\/a\.js:1[\s\S]*TODO/);
  });
});

describe('detect', () => {
  const project = (files) => {
    const dir = tmp();
    for (const [path, text] of Object.entries(files)) write(dir, path, text);
    return detect(dir);
  };

  it('reads a Node project from its manifest and lockfile', () => {
    const found = project({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' }, dependencies: { express: '4' }, devDependencies: { vitest: '2' } }),
      'package-lock.json': '{}',
    });
    assert.equal(found.stack, 'express');
    assert.equal(found.testRunner, 'vitest');
    assert.equal(found.commands.test, 'npm test');
    assert.equal(found.commands.typecheck, 'npm run typecheck');
  });

  it('falls back to tsc when there is only a tsconfig', () => {
    const found = project({ 'package.json': '{"scripts":{"test":"node --test"}}', 'tsconfig.json': '{}', 'pnpm-lock.yaml': '' });
    assert.equal(found.commands.typecheck, 'pnpm exec tsc --noEmit');
    assert.equal(found.testRunner, 'node:test');
  });

  it('reads Python, Go and Rust projects', () => {
    const py = project({ 'pyproject.toml': '[project]\ndependencies=["fastapi"]\n[tool.ruff]\n', 'uv.lock': '' });
    assert.equal(py.stack, 'fastapi');
    assert.equal(py.commands.test, 'uv run pytest');
    assert.equal(py.commands.lint, 'uv run ruff check .');
    assert.equal(project({ 'go.mod': 'module x\n' }).commands.test, 'go test ./...');
    assert.equal(project({ 'Cargo.toml': '[package]\n' }).commands.test, 'cargo test');
  });

  it('leaves the commands empty for a project it does not know', () => {
    const found = project({ 'README.md': 'hello' });
    assert.equal(found.stack, 'unknown');
    assert.equal(found.commands.test, '');
  });
});
