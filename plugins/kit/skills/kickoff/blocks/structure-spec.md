# Structure specs (`<block>.structure.json`)

Machine-readable twin of a rule block's layout rules. `scripts/arch-check.mjs`
(`/kit:audit quick`) reads every `*.structure.json` in this folder, plus a project's own
`.claude/kit-structure/*.structure.json`, and applies the ones that match each scope of
`.claude/kit.json`. Zero LLM tokens: everything here is globs and regexes.

A spec is not copied into `CLAUDE.md`; the prose rule in the block stays the source of
truth, and every check cites that rule's ID. When a block rule changes, its spec changes in
the same commit.

## File

```json
{
  "block": "web-common",
  "version": 1,
  "appliesTo": { "kind": "web", "stacks": "*" },
  "checks": [ { "rule": "W1", "type": "layout", "description": "…", "severity": "HIGH", "fix": "…" } ]
}
```

- `appliesTo.kind`: `"api" | "web" | "mobile"` (matched against `scopes.<name>.kind`, so
  every scope of that kind — `web`, `admin`, `landing` — gets the spec) or `"*"` (every
  scope and the files outside any scope). `appliesTo.stacks`: `"*"` or a list of stacks
  (`["nestjs"]`) matched against `scopes.<name>.stack`. `appliesTo.addon`: the spec applies
  only when that addon is in `kit.json` `addons` (to every scope).
- Paths in checks are globs relative to the scope root (`scopes.<name>.path`), or to the
  repo root for `"*"` and addon specs. A file belongs to the scope with the longest
  matching path. Globs: `**` any depth (`**/x` also matches `x`),
  `*` one segment, `?` one character, `{a,b}` alternatives. Patterns are JavaScript regex
  sources (escape backslashes for JSON: `"\\.ts$"`).
- Every check has `rule` (the block rule ID it enforces), `type`, `description` (one line,
  shown in the report), `severity` (`BLOCKER | HIGH | MEDIUM | LOW`, default `HIGH`), `fix`
  (one line), optional `exclude` (globs) and optional `when: { "exists": "<path>" }` (the
  check runs only if that scope-relative path exists).

## Widening a kit layout (`extend`, project specs only)

A project convention the kit's `layout` check does not know (for example tenancy doors
`orders-db.ts` at a module root) is declared in a project spec, never by editing the kit:

```json
{
  "block": "project-doors",
  "appliesTo": { "kind": "api", "stacks": ["nestjs"] },
  "extend": [{ "rule": "AN1", "unit": "src/modules/*", "allowFiles": ["^[a-z0-9-]+-db\\.ts$"] }]
}
```

Each entry adds its `allowFiles` (and `allowDirs`) to every `layout` check with the same
`rule` and `unit`. It can only allow more names; it never removes or weakens another check.
Record the convention as a `P` rule in the project's `CLAUDE.md` with its reason.

## Check types

| `type` | Fields | Finding when |
|---|---|---|
| `layout` | `unit` (glob ending in `/*`, e.g. `src/app/features/*`), `allowFiles` (regexes; `{unit}` = the unit folder name), `allowDirs` (folder names), `maxMatching` (`{ "pattern", "max" }`) | a file at the unit root matches no `allowFiles`; a first-level folder is not in `allowDirs`; more than `max` root files match `pattern` |
| `names` | `files` (globs), `pattern` (regex on the file name) | a matching file's name does not match `pattern` |
| `forbidden-path` | `files` (globs) | a file matches |
| `forbidden-content` | `files`, `pattern`, optional `flags` (`"i"`), `except` (regex tested on the matching line and the next two), `multiline` (match over the whole file) | the pattern matches a line (or the file) |
| `forbidden-import` | `files`, `imports` (globs on the resolved, scope-relative target of relative and `@/`/`~/` imports), `specifiers` (regexes on the raw specifier, for packages) | an import/require/re-export of a matching file hits either list |
| `no-cross-import` | `unit` (glob ending in `/*`), optional `onlyTargets` (globs on the target) | a file inside one unit imports from a sibling unit |
| `unused-exports` | `files`, `ignoreNames` (regex alternatives) | a named export has no other file in the repo mentioning its name (default exports are skipped) |

Imports are read from `.ts .tsx .js .jsx .mjs .cjs .astro` (ES `import`, `export … from`,
`require()`, `import()`) and `.py` (`from x import`, `import x`; dots resolved).

Python specifics, so `imports` and `no-cross-import` work on a FastAPI scope:

- An absolute import resolves inside the folder named like its top package when the
  importing file sits under it: in `src/shop/core/db.py`, `shop.features.orders.models` →
  `src/shop/features/orders/models`, so a `src/<package>/` layout compares like a flat one.
  Any other absolute import stays a package path (`sqlalchemy/orm`) and is matched with
  `specifiers` (`"^(fastapi|starlette)(\\.|$)"`).
- Resolved targets carry no `.py`: write `**/features/*/repository`, not `repository.py`.
- `from pkg.features.x import repository` is read as an import of `pkg.features.x` (the
  imported names are not resolved); the project's architecture test covers that form.
- Tests that mirror the source tree (`tests/unit/features/<feature>/`,
  `tests/integration/core/<package>/`) match `**/features/*` and `**/core/**` too: exclude
  `tests/**` and `**/tests/**` in checks about source layers.

## What counts

`off` scopes are skipped. By default only changed files are checked (`git diff HEAD` plus
untracked): a finding on a new file or an added line counts for the verdict in `enforce`
and `report` scopes; a finding on code that already existed goes to "Pre-existing". With
`--all` (census) everything counts in `enforce` scopes and everything in `report` scopes is
"Pre-existing". BLOCKER or HIGH that counts → `VERDICT: FAIL`, exit 1.

## Writing a check

- Prefer a check that cannot misfire over one that catches everything; the LLM auditors
  cover the rest. A layer-purity regex lists the exact calls, not a vague word.
- Use MEDIUM for heuristics with plausible false positives (file-name conventions, unused
  exports), HIGH for a broken layer boundary, BLOCKER only for secrets or rules the block
  itself calls BLOCKER.
- Add a case to `scripts/__tests__/arch-check.test.mjs` for every new check type, and run
  `node --test plugins/kit/scripts/__tests__/arch-check.test.mjs`.
