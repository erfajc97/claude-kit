#!/usr/bin/env node
// Live-coding session helper for claude-kit (profile "live").
//
//   node live.mjs init [--budget 60] [--lang es|en] [--force]   baseline, local-only files, kit.json, state
//   node live.mjs status [--json]                               clock, plan progress, next command
//   node live.mjs phase <init|map|plan|step|audit|wrap>
//   node live.mjs step <S1> <todo|doing|done|parked> [--commit <sha>]
//   node live.mjs decide "<question>" "<answer>" [--assumed]
//   node live.mjs park "<idea or risk outside the plan>"
//   node live.mjs changed [--json|--stat]                       files changed since the baseline
//
// Everything the kit writes lives in `.live/` and `.claude/kit*.json` and is hidden from git
// through `.git/info/exclude`, so the diff a reviewer sees holds only code and tests.
// Exit codes: 0 ok, 2 usage, 3 not a git repository, 4 no commit, 5 not initialised,
// 6 no plan, 7 unknown step.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDES = ['.live/', '.claude/kit.json', '.claude/kit-*.json', '.claude/kit/'];
const MARK = { todo: '⬜', doing: '🔄', done: '✅', parked: '⏸' };
const PHASES = ['init', 'map', 'plan', 'step', 'audit', 'wrap'];
const RESERVE_MIN = 12; // audit + wrap + buffer, kept out of the minutes available for steps

class Fail extends Error {
  constructor(error, code, extra = {}) {
    super(error);
    this.code = code;
    this.extra = extra;
  }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function tryGit(cwd, args) {
  try {
    return git(cwd, args).trim();
  } catch {
    return null; // callers turn "no answer" into their own error
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null; // an unreadable file is treated as absent
  }
}

const nul = (text) => text.split('\0').filter(Boolean);
const arg = (args, name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const hhmm = () => new Date().toTimeString().slice(0, 5);
const livePath = (root, ...parts) => join(root, '.live', ...parts);
const rowCells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
const pluginVersion = () => safeJson(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))?.version ?? 'unknown';

function repoRoot() {
  const root = tryGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (!root) throw new Fail('not-a-git-repo', 3, { hint: 'git init and make a baseline commit, then run again' });
  return root;
}

function readState(root) {
  const file = livePath(root, 'state.json');
  const state = existsSync(file) ? safeJson(readFileSync(file, 'utf8')) : null;
  if (!state) throw new Fail('not-initialised', 5, { hint: 'run /kit:live-map first' });
  return state;
}

const writeState = (root, state) => writeFileSync(livePath(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

/** Stack, package manager, test runner and the commands that run tests, lint, types and build. */
export function detect(root) {
  const has = (file) => existsSync(join(root, file));
  const read = (file) => (has(file) ? readFileSync(join(root, file), 'utf8') : '');
  const found = { stack: 'unknown', packageManager: null, testRunner: 'unknown', monorepo: false, commands: { test: '', lint: '', typecheck: '', build: '', dev: '' } };
  const set = (stack, testRunner, commands) => Object.assign(found, { stack, testRunner }, { commands: { ...found.commands, ...commands } });

  if (has('package.json')) {
    const pkg = safeJson(read('package.json')) ?? {};
    const scripts = pkg.scripts ?? {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
    const run = (name) => (pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`);
    const exec = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' }[pm];
    const pick = (...names) => names.find((name) => scripts[name]);
    const frameworks = [['@nestjs/core', 'nestjs'], ['next', 'next'], ['astro', 'astro'], ['expo', 'expo'], ['react-native', 'react-native'], ['@angular/core', 'angular'], ['vue', 'vue'], ['svelte', 'svelte'], ['react', deps.vite ? 'react-vite' : 'react'], ['express', 'express'], ['fastify', 'fastify'], ['hono', 'hono'], ['koa', 'koa']];
    const lint = pick('lint');
    const typecheck = pick('typecheck', 'type-check', 'check-types', 'tsc');
    const build = pick('build');
    const dev = pick('dev', 'start');
    const runner = deps.vitest ? 'vitest' : deps.jest ? 'jest' : deps.mocha ? 'mocha' : /node --test/.test(scripts.test ?? '') ? 'node:test' : 'unknown';
    set(frameworks.find(([dep]) => deps[dep])?.[1] ?? 'node', runner, {
      test: scripts.test ? (pm === 'npm' ? 'npm test' : `${pm} test`) : '',
      lint: lint ? run(lint) : '',
      typecheck: typecheck ? run(typecheck) : has('tsconfig.json') ? `${exec} tsc --noEmit` : '',
      build: build ? run(build) : '',
      dev: dev ? run(dev) : '',
    });
    found.packageManager = pm;
    found.monorepo = Boolean(pkg.workspaces) || has('pnpm-workspace.yaml') || has('turbo.json');
  } else if (['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].some((file) => has(file))) {
    const text = `${read('pyproject.toml')}\n${read('requirements.txt')}`.toLowerCase();
    const pm = has('uv.lock') ? 'uv' : has('poetry.lock') ? 'poetry' : 'pip';
    const py = { uv: 'uv run ', poetry: 'poetry run ', pip: 'python -m ' }[pm];
    const django = has('manage.py') && !text.includes('pytest');
    const stack = text.includes('fastapi') ? 'fastapi' : text.includes('django') || has('manage.py') ? 'django' : text.includes('flask') ? 'flask' : 'python';
    set(stack, django ? 'django' : 'pytest', {
      test: django ? 'python manage.py test' : `${py}pytest`,
      lint: text.includes('ruff') || has('ruff.toml') ? `${py}ruff check .` : '',
      typecheck: text.includes('mypy') || has('mypy.ini') ? `${py}mypy .` : '',
    });
    found.packageManager = pm;
  } else if (has('go.mod')) {
    set('go', 'go test', { test: 'go test ./...', lint: 'go vet ./...', build: 'go build ./...' });
  } else if (has('Cargo.toml')) {
    set('rust', 'cargo test', { test: 'cargo test', lint: 'cargo clippy', build: 'cargo build' });
  } else if (has('pom.xml')) {
    set('java', 'junit', { test: 'mvn -q test', build: 'mvn -q package -DskipTests' });
  } else if (has('build.gradle') || has('build.gradle.kts')) {
    set('java', 'junit', { test: './gradlew test', build: './gradlew build -x test' });
  } else if (readdirSync(root).some((file) => /\.(sln|csproj)$/.test(file))) {
    set('dotnet', 'dotnet test', { test: 'dotnet test', build: 'dotnet build' });
  } else if (has('Gemfile')) {
    set('ruby', has('spec') ? 'rspec' : 'minitest', { test: has('spec') ? 'bundle exec rspec' : 'bundle exec rake test' });
  } else if (has('composer.json')) {
    set('php', 'phpunit', { test: 'vendor/bin/phpunit' });
  }
  return found;
}

function hideFromGit(file) {
  mkdirSync(dirname(file), { recursive: true });
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const missing = EXCLUDES.filter((entry) => !lines.includes(entry));
  if (!missing.length) return;
  const lead = lines.length && lines.at(-1) !== '' ? '\n' : '';
  appendFileSync(file, `${lead}# claude-kit live session (local only)\n${missing.join('\n')}\n`);
}

function kitJson(root, baseSha, detected) {
  const { lint, typecheck, test, build } = detected.commands;
  return {
    kitVersion: pluginVersion(),
    profile: 'live',
    project: basename(root),
    rigor: 'standard',
    locale: { code: 'en', ui: 'en-US' },
    requirements: { source: '.live/statement.md', idScheme: 'R1', checklist: '.live/checklist.md' },
    tracking: 'live',
    commitStyle: 'tags',
    coverage: 0,
    testRunner: { app: detected.testRunner },
    scopes: { app: { kind: 'app', path: '.', mode: 'report' } },
    addons: [],
    commands: { app: { lint, typecheck, test, build } },
    audit: { chain: ['tests', 'challenge', 'security'], milestone: [] },
    seal: false,
    live: { baseSha, rules: '.live/rules.md', stack: detected.stack },
  };
}

function init(args) {
  const root = repoRoot();
  const stateFile = livePath(root, 'state.json');
  const previous = existsSync(stateFile) ? safeJson(readFileSync(stateFile, 'utf8')) : null;
  if (previous && !args.includes('--force')) {
    const { baseSha, phase, budgetMin, lang, stack, commands } = previous;
    return { ok: true, resumed: true, root, baseSha, phase, budgetMin, lang, stack, commands };
  }
  const baseSha = tryGit(root, ['rev-parse', 'HEAD']);
  if (!baseSha) throw new Fail('no-commits', 4, { hint: 'make a baseline commit first: git add -A && git commit -m baseline' });
  const budgetMin = Number(arg(args, '--budget', 60)) || 60;
  const lang = arg(args, '--lang', 'auto');
  const warnings = [];
  const dirty = nul(git(root, ['status', '--porcelain', '-z'])).length;
  if (dirty) warnings.push(`${dirty} uncommitted path(s) at start: they will count as your changes`);
  const detected = detect(root);
  if (detected.monorepo) warnings.push('monorepo detected: the commands are the root ones, ask which package the task touches');
  if (!detected.commands.test) warnings.push('no test command detected: ask which command runs the tests');

  const excludePath = tryGit(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (excludePath) hideFromGit(isAbsolute(excludePath) ? excludePath : resolve(root, excludePath));

  mkdirSync(livePath(root), { recursive: true });
  const rules = join(PLUGIN_ROOT, 'skills', 'kickoff', 'blocks', 'live.md');
  if (existsSync(rules)) writeFileSync(livePath(root, 'rules.md'), readFileSync(rules, 'utf8'));
  else warnings.push('blocks/live.md not found in the plugin: .live/rules.md was not written');
  for (const [file, title] of [['decisions.md', '# Decisions (question → answer)'], ['parked.md', '# Parked (out of plan)']]) {
    if (!existsSync(livePath(root, file))) writeFileSync(livePath(root, file), `${title}\n\n`);
  }

  const kitFile = join(root, '.claude', 'kit.json');
  const existing = existsSync(kitFile) ? safeJson(readFileSync(kitFile, 'utf8')) : null;
  const writeKit = !existsSync(kitFile) || existing?.profile === 'live';
  if (writeKit) {
    mkdirSync(dirname(kitFile), { recursive: true });
    writeFileSync(kitFile, `${JSON.stringify(kitJson(root, baseSha, detected), null, 2)}\n`);
  } else {
    warnings.push('.claude/kit.json already exists and is not a live profile: left untouched');
  }

  writeState(root, {
    version: 1,
    startedAt: new Date().toISOString(),
    budgetMin,
    lang,
    baseSha,
    phase: 'init',
    current: null,
    stack: detected.stack,
    packageManager: detected.packageManager,
    testRunner: detected.testRunner,
    commands: detected.commands,
  });
  return { ok: true, resumed: false, root, branch: tryGit(root, ['branch', '--show-current']), baseSha, budgetMin, lang, ...detected, kitJson: writeKit, warnings };
}

const markName = (cell = '') => Object.entries(MARK).find(([, mark]) => cell.includes(mark))?.[0] ?? 'todo';

function planRows(root) {
  const file = livePath(root, 'plan.md');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map(rowCells)
    .filter((row) => /^S\d+[a-z]?$/i.test(row[0] ?? ''))
    .map((row) => ({ id: row[0], title: row[1], est: Number.parseInt(row[3], 10) || 0, status: markName(row.at(-1)) }));
}

function nextCommand(phase, open) {
  if (phase === 'init') return '/kit:live-map';
  if (phase === 'map') return '/kit:live-plan';
  if (phase === 'plan' || phase === 'step') return open ? '/kit:live-step' : '/kit:live-audit';
  if (phase === 'audit') return '/kit:live-wrap';
  return 'done';
}

function statusOf(root, state) {
  const elapsed = Math.floor((Date.now() - Date.parse(state.startedAt)) / 60000);
  const remaining = state.budgetMin - elapsed;
  const rows = planRows(root);
  const open = rows.filter((row) => row.status === 'todo' || row.status === 'doing');
  const pendingEst = open.reduce((sum, row) => sum + row.est, 0);
  return {
    phase: state.phase,
    elapsed,
    remaining,
    budgetMin: state.budgetMin,
    steps: { total: rows.length, done: rows.filter((row) => row.status === 'done').length, open: open.length, current: state.current, pendingEst },
    overBudget: open.length > 0 && pendingEst > remaining - RESERVE_MIN,
    next: nextCommand(state.phase, open.length),
  };
}

const WORDS = {
  es: { left: 'quedan', phase: 'fase', steps: 'pasos', open: 'pendiente', next: 'siguiente', cur: 'en curso', over: 'NO CABE en el tiempo que queda: recorta alcance' },
  en: { left: 'left', phase: 'phase', steps: 'steps', open: 'open', next: 'next', cur: 'current', over: 'DOES NOT FIT in the time left: cut scope' },
};

function statusLine(status, lang) {
  const w = WORDS[lang === 'en' ? 'en' : 'es'];
  const { steps } = status;
  const parts = [`⏱ ${status.elapsed}/${status.budgetMin} min (${w.left} ${status.remaining})`, `${w.phase} ${status.phase}`];
  if (steps.total) parts.push(`${w.steps} ${steps.done}/${steps.total}${steps.current ? ` (${steps.current} ${w.cur})` : ''}`, `${w.open} ≈ ${steps.pendingEst} min`);
  parts.push(`${w.next} ${status.next}`);
  return parts.join(' · ') + (status.overBudget ? `\n⚠ ${w.over}` : '');
}

function statusCommand(args) {
  const root = repoRoot();
  const state = readState(root);
  const status = statusOf(root, state);
  if (args.includes('--json')) return { ok: true, ...status, lang: state.lang, baseSha: state.baseSha, commands: state.commands };
  return statusLine(status, state.lang);
}

function phase(args) {
  const [name] = args;
  if (!PHASES.includes(name)) throw new Fail('unknown-phase', 2, { hint: PHASES.join(' | ') });
  const root = repoRoot();
  const state = readState(root);
  state.phase = name;
  (state.phases ??= {})[name] = new Date().toISOString();
  writeState(root, state);
  return { ok: true, phase: name };
}

function step(args) {
  const [id, status] = args;
  if (!id || !MARK[status]) throw new Fail('usage', 2, { hint: 'step <S1> todo|doing|done|parked [--commit <sha>]' });
  const root = repoRoot();
  const state = readState(root);
  const file = livePath(root, 'plan.md');
  if (!existsSync(file)) throw new Fail('no-plan', 6, { hint: 'run /kit:live-plan first' });
  let hit = false;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((line) => {
    if (!line.trim().startsWith('|')) return line;
    const row = rowCells(line);
    if (row[0].toLowerCase() !== id.toLowerCase()) return line;
    hit = true;
    row[row.length - 1] = MARK[status];
    return `| ${row.join(' | ')} |`;
  });
  if (!hit) throw new Fail('unknown-step', 7, { id });
  writeFileSync(file, lines.join('\n'));
  if (status === 'doing') state.current = id;
  else if (state.current === id) state.current = null;
  state.phase = 'step';
  const commit = arg(args, '--commit', null);
  if (commit) (state.commits ??= {})[id] = commit;
  writeState(root, state);
  return { ok: true, id, status };
}

function note(file, text) {
  const root = repoRoot();
  readState(root);
  appendFileSync(livePath(root, file), `- [${hhmm()}] ${text}\n`);
  return { ok: true };
}

function decide(args) {
  const [question, answer] = args.filter((item) => item !== '--assumed');
  if (!question || !answer) throw new Fail('usage', 2, { hint: 'decide "<question>" "<answer>" [--assumed]' });
  return note('decisions.md', `Q: ${question} → A: ${answer} (${args.includes('--assumed') ? 'assumed' : 'user'})`);
}

function park(args) {
  if (!args.length) throw new Fail('usage', 2, { hint: 'park "<idea or risk outside the plan>"' });
  return note('parked.md', args.join(' '));
}

function changed(args) {
  const root = repoRoot();
  const { baseSha } = readState(root);
  const tracked = nul(git(root, ['diff', '--name-only', '-z', '--no-renames', baseSha]));
  const fresh = nul(git(root, ['ls-files', '-z', '--others', '--exclude-standard']));
  const files = [...new Set([...tracked, ...fresh])].sort();
  if (args.includes('--json')) return { ok: true, baseSha, files };
  if (args.includes('--stat')) return [git(root, ['diff', '--stat', baseSha]).trimEnd(), fresh.length ? `untracked: ${fresh.join(', ')}` : ''].filter(Boolean).join('\n');
  return files.join('\n');
}

const HELP = `usage: live.mjs <init|status|phase|step|decide|park|changed> ...
  init [--budget 60] [--lang es|en] [--force]   step <S1> todo|doing|done|parked [--commit sha]
  status [--json]                               decide "<question>" "<answer>" [--assumed]
  phase <init|map|plan|step|audit|wrap>         park "<text>"      changed [--json|--stat]`;

const COMMANDS = { init, status: statusCommand, phase, step, decide, park, changed, help: () => HELP };

function main(argv) {
  const [name = 'help', ...args] = argv;
  try {
    if (!COMMANDS[name]) throw new Fail('unknown-command', 2, { hint: HELP });
    const result = COMMANDS[name](args);
    if (typeof result === 'string') console.log(result);
    else if (result) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (!(error instanceof Fail)) throw error;
    console.log(JSON.stringify({ ok: false, error: error.message, ...error.extra }, null, 2));
    process.exitCode = error.code;
  }
}

if (process.argv[1] && /live\.mjs$/.test(process.argv[1])) main(process.argv.slice(2));
