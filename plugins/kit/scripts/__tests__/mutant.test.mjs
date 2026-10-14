// node --test plugins/kit/scripts/__tests__/mutant.test.mjs
//
// The mutation runner must never leave a mutant on disk, must call a run KILLED only when
// a test failed (a syntax error is not a kill), and must say SURVIVED when the suite stays
// green. Each case uses a throw-away project in the temp dir and a tiny fake test command,
// so no real test runner is needed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classify } from '../../skills/kickoff/templates/mutant/mutant.mjs';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'kickoff', 'templates', 'mutant', 'mutant.mjs');
const dirs = [];
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const RULE = 'export const canBuy = (n, max) => n > max ? false : true;\r\n';

/** A project whose "test" fails iff the rule file says `>=`. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-mutant-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'rule.js'), RULE);
  writeFileSync(
    join(dir, 'check.mjs'),
    "import { readFileSync } from 'node:fs';\n" +
      "const killed = readFileSync('src/rule.js', 'utf8').includes('>=');\n" +
      "console.log(killed ? 'AssertionError: expected true\\n Tests  1 failed | 2 passed' : ' Tests  3 passed');\n" +
      'process.exit(killed ? 1 : 0);\n',
  );
  writeFileSync(
    join(dir, 'fake-vitest.mjs'),
    "const { MUTANT_FILE, MUTANT_FROM, MUTANT_TO } = process.env;\n" +
      "if (MUTANT_FILE === 'src/rule.js' && MUTANT_FROM) console.error(`[kit-mutant] applied to ${MUTANT_FILE}`);\n" +
      "if (process.argv[2] === 'syntax') { console.error('SyntaxError: Unexpected token'); process.exit(1); }\n" +
      "const killed = (MUTANT_TO ?? '').includes('>=');\n" +
      "console.log(killed ? ' Tests  1 failed' : ' Tests  3 passed');\n" +
      'process.exit(killed ? 1 : 0);\n',
  );
  return dir;
}

const runner = (dir, args) => spawnSync(process.execPath, [RUNNER, '--cwd', dir, ...args], { encoding: 'utf8' });

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('copy mode (fallback): the source always comes back byte-identical', () => {
  it('a mutant the test catches is KILLED and the file is restored', () => {
    const dir = project();
    const before = sha(join(dir, 'src', 'rule.js'));
    const r = runner(dir, ['--mode', 'copy', '--file', 'src/rule.js', '--from', 'n > max', '--to', 'n >= max', '--', 'node', 'check.mjs']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^KILLED/m);
    assert.equal(sha(join(dir, 'src', 'rule.js')), before);
  });

  it('a mutant the test misses SURVIVED (exit 1) and the file is restored', () => {
    const dir = project();
    const before = sha(join(dir, 'src', 'rule.js'));
    const r = runner(dir, ['--mode', 'copy', '--file', 'src/rule.js', '--from', '? false : true', '--to', '? false : false', '--', 'node', 'check.mjs']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^SURVIVED/m);
    assert.equal(sha(join(dir, 'src', 'rule.js')), before);
  });

  it('a snippet that is not unique is INVALID and nothing is written', () => {
    const dir = project();
    const before = sha(join(dir, 'src', 'rule.js'));
    const r = runner(dir, ['--mode', 'copy', '--file', 'src/rule.js', '--from', 'e', '--to', 'E', '--', 'node', 'check.mjs']);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^INVALID.*occurs \d+ times/m);
    assert.equal(sha(join(dir, 'src', 'rule.js')), before);
  });
});

describe('vitest mode: in memory, with the config installed under node_modules', () => {
  it('passes the mutant through env, installs the config with the chosen base', () => {
    const dir = project();
    const before = sha(join(dir, 'src', 'rule.js'));
    const r = runner(dir, ['--file', 'src/rule.js', '--from', 'n > max', '--to', 'n >= max', '--base', 'vitest.integration.config.ts', '--', 'node', 'fake-vitest.mjs']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^KILLED/m);
    const config = readFileSync(join(dir, 'node_modules', '.kit-mutant', 'vitest.mutant.config.mts'), 'utf8');
    assert.match(config, /from '\.\.\/\.\.\/vitest\.integration\.config\.ts'/);
    assert.equal(sha(join(dir, 'src', 'rule.js')), before);
  });

  it('a mutant that never got applied is INVALID, not KILLED', () => {
    const dir = project();
    const r = runner(dir, ['--file', 'src/other.js', '--from', 'n > max', '--to', 'n >= max', '--', 'node', 'fake-vitest.mjs']);
    assert.equal(r.status, 2);
  });

  it('a failing run without a failing test (syntax error) is INVALID', () => {
    const dir = project();
    const r = runner(dir, ['--file', 'src/rule.js', '--from', 'n > max', '--to', 'n >= max(', '--', 'node', 'fake-vitest.mjs', 'syntax']);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^INVALID.*without a failing test/m);
  });
});

describe('classify', () => {
  it('reads Vitest and Jest summaries', () => {
    assert.equal(classify({ mode: 'copy', status: 1, output: 'Tests:       1 failed, 2 passed, 3 total' }).result, 'KILLED');
    assert.equal(classify({ mode: 'copy', status: 1, output: ' Test Files  1 failed (1)\n Tests  no tests' }).result, 'INVALID');
    assert.equal(classify({ mode: 'copy', status: 0, output: 'Tests  4 passed' }).result, 'SURVIVED');
    assert.equal(classify({ mode: 'vitest', status: 1, output: '[kit-mutant] snippet must occur exactly once' }).result, 'INVALID');
  });
});
