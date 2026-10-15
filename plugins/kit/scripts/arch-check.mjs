#!/usr/bin/env node
// Architecture check of the kit — `/kit:audit quick` (CONVENTIONS §6b). Zero LLM tokens.
//
//   node <kit>/scripts/arch-check.mjs                 changed files (git diff HEAD + untracked)
//   node <kit>/scripts/arch-check.mjs --all           every file of the repo (census)
//   node <kit>/scripts/arch-check.mjs --base main     changed files against another ref
//   node <kit>/scripts/arch-check.mjs -- <paths...>   only these files or folders
//
// It reads `.claude/kit.json` (named scopes: kind, stack, path, mode; addons) and the machine-readable
// structure specs next to the rule blocks (`skills/kickoff/blocks/<block>.structure.json`,
// plus a project's own `.claude/kit-structure/*.structure.json`), checks folder layout,
// allowed files at a feature root, file names, forbidden imports between layers and
// features, and forbidden content per layer, and prints the auditor report of
// CONVENTIONS §5. Exit 0 = PASS, 1 = FAIL, 2 = cannot run.
//
// What counts for the verdict:
//   - `off` scopes are skipped entirely.
//   - Default mode: a finding on NEW code counts — an added file, or an added line of a
//     modified file — in `enforce` and `report` scopes alike (new code follows the rules).
//     A finding on a line or file that already existed goes to "Pre-existing".
//   - `--all` (census): everything counts in `enforce` scopes; everything in `report`
//     scopes goes to "Pre-existing".
//   - Explicit paths behave like `--all` restricted to those paths.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BLOCKS = join(HERE, '..', 'skills', 'kickoff', 'blocks');
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const SEVERITIES = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];
const IGNORED =
  /(^|\/)(node_modules|dist|build|out|coverage|\.git|\.astro|\.expo|\.next|\.turbo|\.vercel|\.output|\.svelte-kit|vendor|__generated__|generated)(\/|$)/;
const BINARY =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|7z|mp3|mp4|mov|webm|wav|ogg|wasm|jar|keystore|jks|p12|der|bin|exe|dll|so|dylib|lockb)$/i;
const LOCKFILES = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|uv\.lock|Cargo\.lock)$/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|astro|py)$/;
const MAX_FILE_BYTES = 1024 * 1024;

/* ─── Globs ──────────────────────────────────────────────────────────────── */

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Regex source of a glob: `**` (any depth), `*`, `?`, `{a,b}`. */
export function globSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      const options = glob.slice(i + 1, end).split(',');
      re += `(?:${options.map((o) => globSource(o)).join('|')})`;
      i = end;
    } else re += escapeRegex(c);
  }
  return re;
}

const globCache = new Map();
export function globMatch(globs, path) {
  for (const glob of [].concat(globs ?? [])) {
    let re = globCache.get(glob);
    if (!re) {
      re = new RegExp(`^${globSource(glob)}$`);
      globCache.set(glob, re);
    }
    if (re.test(path)) return true;
  }
  return false;
}

/** `src/app/features/*` → matches `<prefix>/<unit>/<rest?>`, capturing prefix, unit, rest. */
function unitRegex(unitGlob) {
  if (!unitGlob.endsWith('/*')) throw new Error(`unit "${unitGlob}" must end with "/*"`);
  return new RegExp(`^(${globSource(unitGlob.slice(0, -2))})/([^/]+)(?:/(.*))?$`);
}

/* ─── Git and files ──────────────────────────────────────────────────────── */

function git(root, args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
}

const nul = (text) => text.split('\0').filter(Boolean);

function repoRoot(dir) {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return null;
  }
}

function eligible(path) {
  return !IGNORED.test(path) && !BINARY.test(path) && !LOCKFILES.test(path);
}

/** Added line numbers per modified file, from one `git diff -U0`. */
function addedLines(root, base, files) {
  const result = new Map(files.map((f) => [f, new Set()]));
  if (files.length === 0) return result;
  let out;
  try {
    out = git(root, ['diff', base, '-U0', '--no-color', '--no-renames', '--no-ext-diff', '--', ...files]);
  } catch {
    return result;
  }
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/\t$/, '').replace(/^b\//, '');
      current = result.get(path) ?? null;
    } else if (current && line.startsWith('@@')) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let n = start; n < start + count; n++) current.add(n);
    }
  }
  return result;
}

/**
 * The files to check: `{ path, isNew, lines }` where `lines` is the set of added line
 * numbers (null = every line is new).
 */
export function collectFiles(root, { all = false, base = 'HEAD', paths = [] } = {}) {
  if (all || paths.length > 0) {
    const listed = nul(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
    const wanted = paths.map((p) => p.replaceAll('\\', '/').replace(/\/$/, ''));
    return listed
      .filter((p) => existsSync(join(root, p)))
      .filter((p) => wanted.length === 0 || wanted.some((w) => p === w || p.startsWith(`${w}/`)))
      .filter(eligible)
      .map((path) => ({ path, isNew: true, lines: null }));
  }
  let diff;
  try {
    diff = nul(git(root, ['diff', base, '--name-status', '-z', '--no-renames']));
  } catch {
    diff = nul(git(root, ['diff', EMPTY_TREE, '--name-status', '-z', '--no-renames']));
    base = EMPTY_TREE;
  }
  const files = [];
  const modified = [];
  for (let i = 0; i + 1 < diff.length; i += 2) {
    const [status, path] = [diff[i], diff[i + 1]];
    if (status === 'D' || !eligible(path)) continue;
    if (status === 'A') files.push({ path, isNew: true, lines: null });
    else {
      modified.push(path);
      files.push({ path, isNew: false, lines: null });
    }
  }
  for (const path of nul(git(root, ['ls-files', '-z', '--others', '--exclude-standard']))) {
    if (eligible(path)) files.push({ path, isNew: true, lines: null });
  }
  const lines = addedLines(root, base, modified);
  for (const file of files) if (!file.isNew) file.lines = lines.get(file.path) ?? new Set();
  return files.filter((f) => existsSync(join(root, f.path)));
}

/* ─── Configuration and specs ────────────────────────────────────────────── */

function normalizeScopePath(path) {
  const clean = String(path ?? '').replaceAll('\\', '/').replace(/^\.\/?/, '').replace(/\/$/, '');
  return clean === '.' ? '' : clean;
}

export function loadKit(root) {
  const file = join(root, '.claude', 'kit.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadSpecs(dirs) {
  const specs = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.structure.json')) continue;
      const spec = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      spec.file = name;
      specs.push(spec);
    }
  }
  return specs;
}

/** `appliesTo.kind` (`api | web | mobile | *`); `scope` is accepted as an older spelling. */
const specKind = (spec) => spec.appliesTo?.kind ?? spec.appliesTo?.scope;

/** The specs that apply to one scope (kind + stack) given the enabled addons. */
function specsFor(specs, { kind, stack }, addons) {
  return specs.filter((spec) => {
    const to = spec.appliesTo ?? {};
    if (to.addon) return addons.includes(to.addon);
    const wanted = specKind(spec);
    if (wanted === '*' || wanted === undefined) return true;
    if (wanted !== kind) return false;
    return to.stacks === '*' || to.stacks === undefined || [].concat(to.stacks).includes(stack);
  });
}

/* ─── Imports ────────────────────────────────────────────────────────────── */

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** `{ specifier, line }` for every import/require/re-export of a source file. */
export function extractImports(path, text) {
  const found = [];
  const add = (specifier, index) => found.push({ specifier, line: lineAt(text, index) });
  if (path.endsWith('.py')) {
    for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm)) add(m[1], m.index);
    for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
      for (const name of m[1].split(',')) add(name.trim(), m.index);
    }
    return found;
  }
  for (const m of text.matchAll(/^[ \t]*import\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/gm)) {
    add(m[1], m.index);
  }
  for (const m of text.matchAll(/^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/gm)) {
    add(m[1], m.index);
  }
  for (const m of text.matchAll(/\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g)) add(m[1], m.index);
  return found;
}

/**
 * Absolute Python import → scope-relative path. When the importing file sits inside a
 * folder named like the import's top package (`src/shop/core/db.py` importing
 * `shop.features.orders`), the import resolves inside that folder
 * (`src/shop/features/orders`), so `src/<package>/` layouts compare like flat ones.
 */
function pythonAbsolute(scopeRel, rest) {
  const folders = posix.dirname(scopeRel).split('/');
  const at = folders.indexOf(rest.split('/')[0]);
  return at > 0 ? `${folders.slice(0, at).join('/')}/${rest}` : rest;
}

/** Scope-relative path an import points to, or null for a package import. */
export function resolveImport(scopeRel, specifier, isPython) {
  if (isPython) {
    const dots = /^\.*/.exec(specifier)[0].length;
    const rest = specifier.slice(dots).replaceAll('.', '/');
    if (dots === 0) return pythonAbsolute(scopeRel, rest);
    let base = posix.dirname(scopeRel);
    for (let i = 1; i < dots; i++) base = posix.dirname(base);
    return posix.normalize(rest ? `${base}/${rest}` : base);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return posix.normalize(posix.join(posix.dirname(scopeRel), specifier));
  }
  if (/^[@~#]\//.test(specifier)) return `src/${specifier.slice(2)}`;
  return null;
}

/* ─── Checks ─────────────────────────────────────────────────────────────── */

function appliesTo(check, rel) {
  return globMatch(check.files ?? '**', rel) && !globMatch(check.exclude ?? [], rel);
}

const snippet = (text) => text.trim().replace(/\s+/g, ' ').slice(0, 80);

function patternRegex(source, flags = '') {
  return new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
}

/** Runs one check over the files of one scope; pushes raw findings `{file, line, message}`. */
function runCheck(check, files, ctx) {
  const hits = [];
  const hit = (file, line, message) => hits.push({ file, line, message });
  const read = (file) => ctx.read(file.path);

  switch (check.type) {
    case 'layout': {
      const re = unitRegex(check.unit);
      const allow = (check.allowFiles ?? []).map((p) => p);
      for (const file of files) {
        if (globMatch(check.exclude ?? [], file.rel)) continue;
        const m = re.exec(file.rel);
        if (!m || m[3] === undefined) continue;
        const [, prefix, unit, rest] = m;
        const allowed = allow.map((p) => new RegExp(p.replaceAll('{unit}', escapeRegex(unit))));
        if (!rest.includes('/')) {
          if (allowed.length > 0 && !allowed.some((r) => r.test(rest))) {
            hit(file, null, `\`${rest}\` is not allowed at the root of \`${prefix}/${unit}\` (allowed: ${allow.join(', ')})`);
          } else if (check.maxMatching && new RegExp(check.maxMatching.pattern).test(rest)) {
            const dir = join(ctx.root, ctx.scopePath, prefix, unit);
            const roots = readdirSync(dir).filter((n) => new RegExp(check.maxMatching.pattern).test(n));
            if (roots.length > check.maxMatching.max) {
              hit(file, null, `\`${prefix}/${unit}\` has ${roots.length} root files matching ${check.maxMatching.pattern} (${roots.join(', ')}); at most ${check.maxMatching.max}`);
            }
          }
        } else if (check.allowDirs) {
          const dir = rest.split('/')[0];
          if (!check.allowDirs.includes(dir)) {
            hit(file, null, `folder \`${dir}/\` is not a layer of \`${prefix}/${unit}\` (allowed: ${check.allowDirs.join(', ')})`);
          }
        }
      }
      break;
    }
    case 'names': {
      const re = new RegExp(check.pattern);
      for (const file of files) {
        if (!appliesTo(check, file.rel)) continue;
        const name = posix.basename(file.rel);
        if (!re.test(name)) hit(file, null, `file name \`${name}\` does not match ${check.pattern}`);
      }
      break;
    }
    case 'forbidden-path': {
      for (const file of files) if (appliesTo(check, file.rel)) hit(file, null, `\`${file.rel}\` should not exist here`);
      break;
    }
    case 'forbidden-content': {
      const except = check.except ? new RegExp(check.except, check.flags ?? '') : null;
      for (const file of files) {
        if (!appliesTo(check, file.rel)) continue;
        const text = read(file);
        if (text === null) continue;
        if (check.multiline) {
          for (const m of text.matchAll(patternRegex(check.pattern, `${check.flags ?? ''}s`))) {
            if (except && except.test(m[0])) continue;
            hit(file, lineAt(text, m.index), `\`${snippet(m[0])}\``);
          }
          continue;
        }
        const lines = text.split(/\r?\n/);
        const re = new RegExp(check.pattern, check.flags ?? '');
        lines.forEach((line, i) => {
          if (!re.test(line)) return;
          if (except && except.test(lines.slice(i, i + 3).join('\n'))) return;
          hit(file, i + 1, `\`${snippet(line)}\``);
        });
      }
      break;
    }
    case 'forbidden-import': {
      const specifiers = (check.specifiers ?? []).map((s) => new RegExp(s));
      for (const file of files) {
        if (!appliesTo(check, file.rel) || !CODE.test(file.rel)) continue;
        const text = read(file);
        if (text === null) continue;
        for (const { specifier, line } of extractImports(file.rel, text)) {
          const resolved = resolveImport(file.rel, specifier, file.rel.endsWith('.py'));
          const byPath = resolved !== null && check.imports && globMatch(check.imports, resolved);
          const bySpecifier = specifiers.some((r) => r.test(specifier));
          if (byPath || bySpecifier) hit(file, line, `imports \`${specifier}\``);
        }
      }
      break;
    }
    case 'no-cross-import': {
      const re = unitRegex(check.unit);
      for (const file of files) {
        if (!CODE.test(file.rel) || globMatch(check.exclude ?? [], file.rel)) continue;
        const own = re.exec(file.rel);
        if (!own || own[3] === undefined) continue;
        const text = read(file);
        if (text === null) continue;
        for (const { specifier, line } of extractImports(file.rel, text)) {
          const resolved = resolveImport(file.rel, specifier, file.rel.endsWith('.py'));
          if (resolved === null) continue;
          const target = re.exec(resolved);
          if (!target || target[1] !== own[1] || target[2] === own[2]) continue;
          if (check.onlyTargets && !globMatch(check.onlyTargets, resolved)) continue;
          hit(file, line, `\`${own[2]}\` imports from another unit: \`${specifier}\``);
        }
      }
      break;
    }
    case 'unused-exports': {
      const ignore = check.ignoreNames ? new RegExp(`^(${check.ignoreNames})$`) : null;
      for (const file of files) {
        if (!appliesTo(check, file.rel) || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.rel)) continue;
        const text = read(file);
        if (text === null) continue;
        const exported = [];
        // Default exports are imported under any name: only named exports are checked.
        for (const m of text.matchAll(/^[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
          exported.push({ name: m[1], line: lineAt(text, m.index) });
        }
        for (const m of text.matchAll(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm)) {
          for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) exported.push({ name, line: lineAt(text, m.index) });
          }
        }
        for (const { name, line } of exported) {
          if (ignore?.test(name)) continue;
          if (!ctx.usedElsewhere(name, file.path)) hit(file, line, `export \`${name}\` has no importer in the repo`);
        }
      }
      break;
    }
    default:
      throw new Error(`unknown check type "${check.type}"`);
  }
  return hits;
}

/* ─── Run ────────────────────────────────────────────────────────────────── */

/** Every finding with `counted` decided by the scope mode and whether the code is new. */
export function archCheck({ root, all = false, base = 'HEAD', paths = [], blocksDir = DEFAULT_BLOCKS }) {
  const kit = loadKit(root);
  const notes = [];
  const scopes = [];
  if (!kit) notes.push('No `.claude/kit.json`: only the general checks ran, on the whole change. Run `/kit:adopt` to declare scopes.');
  for (const [name, scope] of Object.entries(kit?.scopes ?? {})) {
    const entry = {
      area: name,
      kind: scope.kind ?? name,
      stack: scope.stack,
      path: normalizeScopePath(scope.path),
      mode: scope.mode ?? 'enforce',
    };
    if (entry.mode === 'off') notes.push(`Scope \`${name}\` is \`off\`: skipped.`);
    scopes.push(entry);
  }
  const addons = kit?.addons ?? [];
  const specs = loadSpecs([blocksDir, join(root, '.claude', 'kit-structure')]);
  for (const s of scopes.filter((x) => x.mode !== 'off')) {
    const stackSpec = specs.some((spec) => specKind(spec) === s.kind && [].concat(spec.appliesTo?.stacks ?? []).includes(s.stack));
    if (s.stack && !stackSpec) notes.push(`No structure spec for stack \`${s.stack}\` (scope \`${s.area}\`, kind \`${s.kind}\`): only its common checks ran.`);
  }

  const files = collectFiles(root, { all, base, paths });
  const census = all || paths.length > 0;
  const byLongestPath = [...scopes].sort((a, b) => b.path.length - a.path.length);
  const shared = { area: 'shared', kind: 'shared', stack: null, path: '', mode: 'enforce' };
  const groups = new Map();
  for (const file of files) {
    const scope =
      byLongestPath.find((s) => s.path === '' || file.path === s.path || file.path.startsWith(`${s.path}/`)) ?? shared;
    if (scope.mode === 'off') continue;
    if (!groups.has(scope)) groups.set(scope, []);
    groups.get(scope).push({ ...file, rel: scope.path ? file.path.slice(scope.path.length + 1) : file.path });
  }

  const cache = new Map();
  const read = (path) => {
    if (!cache.has(path)) {
      const abs = join(root, path);
      cache.set(path, statSync(abs).size > MAX_FILE_BYTES ? null : readFileSync(abs, 'utf8'));
    }
    return cache.get(path);
  };
  let corpus = null;
  const usedElsewhere = (name, own) => {
    if (!corpus) {
      corpus = nul(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
        .filter((p) => CODE.test(p) && eligible(p) && existsSync(join(root, p)))
        .map((p) => ({ path: p, text: read(p) ?? '' }));
    }
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`);
    return corpus.some((f) => f.path !== own && re.test(f.text));
  };

  const findings = [];
  const checksRun = [];
  for (const [scope, scopeFiles] of groups) {
    const applicable = specsFor(specs, scope, addons);
    for (const spec of applicable) {
      for (const check of spec.checks ?? []) {
        if (check.when?.exists && !existsSync(join(root, scope.path, check.when.exists))) continue;
        const ctx = { root, scopePath: scope.path, read, usedElsewhere };
        const hits = runCheck(check, scopeFiles, ctx);
        checksRun.push({ check, scope, files: scopeFiles.length });
        for (const h of hits) {
          const isNewCode = h.file.isNew || (h.line !== null && h.file.lines?.has(h.line));
          const counted = census ? scope.mode === 'enforce' : isNewCode;
          findings.push({
            sev: check.severity ?? 'HIGH',
            rule: check.rule,
            file: h.file.path,
            line: h.line,
            message: `${check.description}: ${h.message}`,
            fix: check.fix ?? '',
            counted,
            check,
            scope: scope.area,
          });
        }
      }
    }
  }
  return { files, groups, findings, checksRun, notes, census };
}

/* ─── Report ─────────────────────────────────────────────────────────────── */

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const where = (f) => (f.line ? `${f.file}:${f.line}` : f.file);
const bySeverity = (a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) || where(a).localeCompare(where(b));

export function renderReport({ files, groups, findings, checksRun, notes, census }) {
  const counted = findings.filter((f) => f.counted).sort(bySeverity);
  const previous = findings.filter((f) => !f.counted).sort(bySeverity);
  const scopeNames = [...groups.keys()].map((s) => `${s.area}${s.mode === 'report' ? ' (report)' : ''}`);
  const out = [];
  out.push(`## arch-check — ${scopeNames.join(', ') || 'nothing to check'} (${files.length} file(s), ${census ? 'census' : 'changed files'})`);
  out.push('### Passed');
  const seen = new Set();
  let passed = 0;
  for (const { check, scope, files: n } of checksRun) {
    const key = `${scope.area}|${check.rule}|${check.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = findings.filter((f) => f.check === check && f.scope === scope.area);
    if (mine.some((f) => f.counted)) continue;
    const old = mine.length ? `; ${mine.length} pre-existing` : '';
    out.push(`- ${check.rule} ${check.description} ✔ (${scope.area}: ${n} file(s) checked${old})`);
    passed++;
  }
  if (passed === 0) out.push('- (no check passed or none applied)');
  out.push('### Findings');
  out.push('| Sev | Rule | File:line | Finding | Fix |');
  out.push('|---|---|---|---|---|');
  for (const f of counted) out.push(`| ${f.sev} | ${f.rule} | ${cell(where(f))} | ${cell(f.message)} | ${cell(f.fix)} |`);
  if (counted.length === 0) out.push('| — | — | — | none | — |');
  out.push('### Pre-existing (not counted)');
  out.push('| Sev | Rule | File:line | Finding |');
  out.push('|---|---|---|---|');
  for (const f of previous) out.push(`| ${f.sev} | ${f.rule} | ${cell(where(f))} | ${cell(f.message)} |`);
  if (previous.length === 0) out.push('| — | — | — | none |');
  if (notes.length > 0) {
    out.push('### Notes for the owner');
    for (const n of notes) out.push(`- ${n}`);
  }
  const blockers = counted.filter((f) => f.sev === 'BLOCKER').length;
  const highs = counted.filter((f) => f.sev === 'HIGH').length;
  const verdict = blockers + highs > 0 ? `FAIL (${blockers} BLOCKER, ${highs} HIGH)` : 'PASS';
  out.push(`VERDICT: ${verdict}`);
  return { text: out.join('\n'), pass: blockers + highs === 0 };
}

/* ─── CLI ────────────────────────────────────────────────────────────────── */

export function parseArgs(argv) {
  const options = { all: false, base: 'HEAD', paths: [], blocksDir: DEFAULT_BLOCKS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') options.all = true;
    else if (a === '--base') options.base = argv[++i];
    else if (a === '--blocks') options.blocksDir = argv[++i];
    else if (a === '--') {
      options.paths.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else options.paths.push(a);
  }
  if (!options.base) throw new Error('--base needs a ref');
  return options;
}

const isEntryPoint = process.argv[1] && /arch-check\.mjs$/.test(process.argv[1]);
if (isEntryPoint) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const root = repoRoot(process.cwd());
    if (!root) throw new Error('not inside a git repository');
    const { text, pass } = renderReport(archCheck({ root, ...options }));
    process.stdout.write(`${text}\n`);
    process.exit(pass ? 0 : 1);
  } catch (err) {
    process.stderr.write(`arch-check could not run: ${err?.message ?? err}\n`);
    process.exit(2);
  }
}
