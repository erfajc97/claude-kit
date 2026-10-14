// node --test plugins/kit/scripts/__tests__/seal-guard.test.mjs
//
// If the guard lets an unaudited file into a sealed project's commit, the seal is paper;
// if it blocks or even prints something in a project that never opted in, nobody can keep
// the plugin installed. Both sides are tested here against real git repositories created
// in the system temp dir (never inside this repo).

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commitStagesItself, gitInvocations } from '../seal-guard.mjs';
import { contentHash } from '../seal-lib.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(SCRIPTS, 'seal-guard.mjs');
const WRITER = join(SCRIPTS, 'seal-write.mjs');

const repos = [];
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** A throw-away repo with one base commit and no hooks from the machine. */
function makeRepo({ kit, autocrlf = 'false' } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'kit-seal-'));
  repos.push(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.autocrlf', autocrlf]);
  mkdirSync(join(repo, '.git', 'no-hooks'));
  git(repo, ['config', 'core.hooksPath', join(repo, '.git', 'no-hooks')]);
  write(repo, 'README.md', 'base\n');
  if (kit !== undefined) write(repo, '.claude/kit.json', typeof kit === 'string' ? kit : JSON.stringify(kit));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

function write(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

/** Runs the hook exactly as Claude Code does: JSON payload on stdin. */
function guard(repo, command, { tool = 'Bash', raw } = {}) {
  const input = raw ?? JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: repo });
  return spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8' });
}

function seal(repo, ...args) {
  return spawnSync(process.execPath, [WRITER, ...args], { cwd: repo, encoding: 'utf8' });
}

const silentPass = (r) => {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
};

after(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

describe('projects that did not opt in: a strict no-op', () => {
  it('no kit.json: an unsealed staged file commits, with no output', () => {
    const repo = makeRepo();
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    git(repo, ['add', 'src/a.ts']);
    silentPass(guard(repo, 'git commit -m "add a"'));
  });

  it('seal false: an unsealed staged file commits, with no output', () => {
    const repo = makeRepo({ kit: { seal: false } });
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    git(repo, ['add', 'src/a.ts']);
    silentPass(guard(repo, 'git commit -m "add a"'));
  });

  it('kit.json without the seal key behaves like seal false', () => {
    const repo = makeRepo({ kit: { project: 'x' } });
    write(repo, 'src/a.ts', 'x\n');
    git(repo, ['add', 'src/a.ts']);
    silentPass(guard(repo, 'git add -A && git commit -am "x"'));
  });

  it('outside any git repository: no output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-seal-nogit-'));
    repos.push(dir);
    silentPass(guard(dir, 'git commit -m x'));
  });

  it('a payload that is not JSON: no output', () => {
    silentPass(guard(tmpdir(), '', { raw: 'not json' }));
  });
});

describe('commands that are not a commit pass untouched, even with the seal on', () => {
  const repo = makeRepo({ kit: { seal: true } });
  write(repo, 'src/a.ts', 'unsealed\n');
  git(repo, ['add', 'src/a.ts']);
  for (const command of [
    'git status',
    'npm test',
    'git log --grep commit',
    'git show HEAD --stat',
    'echo done',
    'node scripts/commit-message-lint.mjs',
  ]) {
    it(command, () => silentPass(guard(repo, command)));
  }
});

describe('sealed project: the staged content must match a PASS seal', () => {
  let repo;
  beforeEach(() => {
    repo = makeRepo({ kit: { seal: true } });
  });

  it('sealed and unchanged: the commit passes silently', () => {
    write(repo, 'src/a.ts', 'export const a = 1;\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    git(repo, ['add', 'src/a.ts']);
    silentPass(guard(repo, 'git commit -F .git/MSG'));
  });

  it('a staged file missing from the seal blocks with exit 2 and names it', () => {
    write(repo, 'src/a.ts', 'a\n');
    write(repo, 'src/b.ts', 'b\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    git(repo, ['add', 'src/a.ts', 'src/b.ts']);
    const r = guard(repo, 'git commit -m "a and b"');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /src\/b\.ts \(not in the seal\)/);
    assert.doesNotMatch(r.stderr, /src\/a\.ts/);
    assert.match(r.stderr, /\/kit:audit/);
  });

  it('a file changed after the seal blocks with exit 2', () => {
    write(repo, 'src/a.ts', 'audited\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    write(repo, 'src/a.ts', 'edited after the audit\n');
    git(repo, ['add', 'src/a.ts']);
    const r = guard(repo, 'git commit -m x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /src\/a\.ts \(content changed after the seal\)/);
  });

  it('the INDEX is checked, not the disk: an old staged version blocks', () => {
    write(repo, 'src/a.ts', 'first\n');
    git(repo, ['add', 'src/a.ts']);
    write(repo, 'src/a.ts', 'fixed after the audit\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    assert.equal(guard(repo, 'git commit -m x').status, 2);
    git(repo, ['add', 'src/a.ts']);
    silentPass(guard(repo, 'git commit -m x'));
  });

  it('no seal file at all blocks', () => {
    write(repo, 'src/a.ts', 'a\n');
    git(repo, ['add', 'src/a.ts']);
    const r = guard(repo, 'git commit -m x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no \.claude\/kit-seal\.json yet/);
  });

  it('a seal whose verdict is not PASS blocks', () => {
    write(repo, 'src/a.ts', 'a\n');
    write(repo, '.claude/kit-seal.json', JSON.stringify({
      paths: ['src/a.ts'],
      sha256: { 'src/a.ts': contentHash(Buffer.from('a\n')) },
      verdict: 'FAIL',
      at: new Date().toISOString(),
    }));
    git(repo, ['add', 'src/a.ts']);
    const r = guard(repo, 'git commit -m x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a PASS/);
  });

  it('a sealed deletion passes; an unsealed deletion blocks', () => {
    git(repo, ['rm', '-q', 'README.md']);
    assert.equal(guard(repo, 'git commit -m x').status, 2);
    assert.equal(seal(repo, '--', 'README.md').status, 0);
    silentPass(guard(repo, 'git commit -m x'));
  });

  it('the kit state files never need a seal', () => {
    write(repo, 'src/a.ts', 'a\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    git(repo, ['add', 'src/a.ts', '.claude/kit-seal.json']);
    silentPass(guard(repo, 'git commit -m x'));
  });

  it('staging and committing in one command is refused', () => {
    write(repo, 'src/a.ts', 'a\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    for (const command of [
      'git add src/a.ts && git commit -m x',
      'git commit -am "x"',
      'git commit -a -m x',
      'git commit -m x -- src/a.ts',
      'git commit --only src/a.ts -m x',
    ]) {
      const r = guard(repo, command);
      assert.equal(r.status, 2, command);
      assert.match(r.stderr, /stages files and commits in one step/, command);
    }
  });

  it('PowerShell, `git -C` and `cd` forms reach the right repository', () => {
    write(repo, 'src/a.ts', 'a\n');
    git(repo, ['add', 'src/a.ts']);
    const elsewhere = mkdtempSync(join(tmpdir(), 'kit-seal-cwd-'));
    repos.push(elsewhere);
    const fromElsewhere = (command, tool) =>
      spawnSync(process.execPath, [GUARD], {
        input: JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: elsewhere }),
        encoding: 'utf8',
      });
    assert.equal(fromElsewhere(`git -C "${repo}" commit -m x`, 'Bash').status, 2);
    assert.equal(fromElsewhere(`cd "${repo}" && git commit -m x`, 'Bash').status, 2);
    assert.equal(fromElsewhere(`Set-Location "${repo}"; git commit -m x`, 'PowerShell').status, 2);
    silentPass(fromElsewhere('git commit -m x', 'Bash')); // elsewhere is not a repo
  });

  it('CRLF on disk matches the LF blob git stores with autocrlf', () => {
    const crlf = makeRepo({ kit: { seal: true }, autocrlf: 'true' });
    write(crlf, 'src/a.ts', 'line one\r\nline two\r\n');
    assert.equal(seal(crlf, '--', 'src/a.ts').status, 0);
    git(crlf, ['add', 'src/a.ts']);
    silentPass(guard(crlf, 'git commit -m x'));
  });

  it('during a merge, files taken as-is from the other side need no seal', () => {
    git(repo, ['checkout', '-q', '-b', 'feature']);
    write(repo, 'src/feature.ts', 'feature\n');
    git(repo, ['add', 'src/feature.ts']);
    git(repo, ['commit', '-q', '-m', 'feature']);
    git(repo, ['checkout', '-q', '-']);
    write(repo, 'src/main.ts', 'main\n');
    git(repo, ['add', 'src/main.ts']);
    git(repo, ['commit', '-q', '-m', 'main']);
    git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'feature']);
    silentPass(guard(repo, 'git commit -m merge'));
    // A resolution edit is new work: it needs the seal like any other change.
    write(repo, 'src/feature.ts', 'feature, resolved by hand\n');
    git(repo, ['add', 'src/feature.ts']);
    const r = guard(repo, 'git commit -m merge');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /src\/feature\.ts/);
  });

  it('invalid kit.json that opts in blocks with a clear reason', () => {
    const broken = makeRepo({ kit: '{ "seal": true, }' });
    write(broken, 'src/a.ts', 'a\n');
    git(broken, ['add', 'src/a.ts']);
    const r = guard(broken, 'git commit -m x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not valid JSON/);
  });
});

describe('seal-write', () => {
  it('writes the CONVENTIONS shape: paths, sha256, verdict PASS, ISO time', () => {
    const repo = makeRepo({ kit: { seal: true } });
    write(repo, 'src/a.ts', 'a\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    const written = JSON.parse(readFileSync(join(repo, '.claude/kit-seal.json'), 'utf8'));
    assert.deepEqual(Object.keys(written).sort(), ['at', 'paths', 'sha256', 'verdict']);
    assert.deepEqual(written.paths, ['src/a.ts']);
    assert.equal(written.sha256['src/a.ts'], contentHash(Buffer.from('a\n')));
    assert.equal(written.verdict, 'PASS');
    assert.ok(!Number.isNaN(Date.parse(written.at)));
  });

  it('refuses folders, globs, no paths, and --add without a PASS seal (FT3: by reason)', () => {
    const repo = makeRepo({ kit: { seal: true } });
    write(repo, 'src/a.ts', 'a\n');
    const refused = (args, reason) => {
      const r = seal(repo, ...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, reason, args.join(' '));
    };
    refused(['--', 'src'], /is a folder/);
    refused(['--', 'src/*.ts'], /is a pattern/);
    refused(['--'], /Usage/);
    refused(['--', 'src/missing.ts'], /does not exist/);
    refused(['--add', '--', 'src/a.ts'], /needs an existing PASS seal/);
    write(repo, '.claude/kit-seal.json', JSON.stringify({ paths: [], sha256: {}, verdict: 'FAIL', at: 'x' }));
    refused(['--add', '--', 'src/a.ts'], /needs an existing PASS seal/);
  });

  it('--add keeps the sealed files and adds the new ones', () => {
    const repo = makeRepo({ kit: { seal: true } });
    write(repo, 'src/a.ts', 'a\n');
    write(repo, 'docs/progress.md', '- [x] done\n');
    assert.equal(seal(repo, '--', 'src/a.ts').status, 0);
    assert.equal(seal(repo, '--add', '--', 'docs/progress.md').status, 0);
    const written = JSON.parse(readFileSync(join(repo, '.claude/kit-seal.json'), 'utf8'));
    assert.deepEqual(written.paths, ['docs/progress.md', 'src/a.ts']);
  });
});

describe('command parsing', () => {
  it('finds commits behind options, wrappers and separators', () => {
    const subs = (c) => gitInvocations(c).map((g) => g.sub);
    assert.deepEqual(subs('rtk git commit -m x'), ['commit']);
    assert.deepEqual(subs('git -c user.name=x --no-pager commit -m x'), ['commit']);
    assert.deepEqual(subs('git status; git commit -F msg.txt'), ['status', 'commit']);
    assert.deepEqual(subs('git log --grep "git commit"'), ['log']);
  });

  it('tells message values from pathspecs', () => {
    const stages = (c) => commitStagesItself(gitInvocations(c).find((g) => g.sub === 'commit').args);
    assert.equal(stages('git commit -m "fix: add a thing"'), false);
    assert.equal(stages('git commit -qm x'), false);
    assert.equal(stages('git commit -S -m x'), false);
    assert.equal(stages('git commit -uno -m x'), false);
    assert.equal(stages('git commit --amend --no-edit'), false);
    assert.equal(stages(`git commit -m "$(cat <<'EOF'\nsubject\n\nbody\nEOF\n)"`), false);
    assert.equal(stages('git commit -F - <<EOF'), false);
    assert.equal(stages('git commit -am x'), true);
    assert.equal(stages('git commit -m x file.ts'), true);
    assert.equal(stages('git commit --all -m x'), true);
  });
});
