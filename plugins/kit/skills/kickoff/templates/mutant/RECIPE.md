# Mutation check recipe (G3)

Copied by `/kit:kickoff` and `/kit:adopt` to `.claude/kit/mutant/`. Builders and
`auditor-tests` use it to prove that a test FAILS when a rule breaks. The source file is
never edited in place: the mutant lives in memory (Vitest) or, as a fallback, the original
is backed up, mutated, restored and verified byte for byte.

## Before you start

- The touched suite is green (a mutant on a red baseline proves nothing).
- Pick ONE rule and its mutant: flip a comparison (`>` ↔ `>=`), drop a guard or a `where`
  condition (owner, tenant, status), return a constant, remove an `increment`, an
  invalidation or `enabled`, swap the error-code branch, drop a schema `.max()`.
- The `--from` snippet must occur exactly once in the file; copy it verbatim.

## Vitest (default, in memory)

From the repo root, one mutant per run (`<scope>` = `scopes.<name>.path` of `kit.json`,
`<pm>` = `pnpm exec`, `npx` or `yarn`):

```bash
node .claude/kit/mutant/mutant.mjs --cwd <scope> \
  --file src/modules/orders/orders.service.ts \
  --from 'used + quantity <= limit' --to 'used + quantity < limit' \
  -- <pm> vitest run --root . --config node_modules/.kit-mutant/vitest.mutant.config.mts \
     src/modules/orders/__tests__/orders.service.spec.ts
```

- `--file` is relative to `--cwd`, with forward slashes.
- `--base <config>` names the Vitest config the mutant extends. Pass it whenever the
  project's config is not the default name (`vitest.config.mts`, `vite.config.ts`, a
  mobile `vitest.config.ts` with native mocks…) and for integration specs
  (`--base vitest.integration.config.ts`).
- PowerShell: write the same command on ONE line (no `\` continuations); quote snippets
  with single quotes.
- The runner installs `vitest.mutant.config.mts` into `<scope>/node_modules/.kit-mutant/`
  (ignored by git and dev servers), sets `MUTANT_FILE` / `MUTANT_FROM` / `MUTANT_TO`, and
  compares the file's sha256 before and after.

## Fallback: copy and restore (Jest, pytest or a runner without transforms)

```bash
node .claude/kit/mutant/mutant.mjs --mode copy --cwd <scope> \
  --file src/cart/limits.ts --from 'items.length >= MAX' --to 'items.length > MAX' \
  -- <pm> jest src/cart/__tests__/limits.test.ts
```

Use it only when no dev server, watcher or other agent reads that file during the run, and
say so in the report. The runner backs the file up to the temp dir, writes the mutant, runs
the command, rewrites the original in a `finally` (retrying while Windows holds a lock) and
checks the sha256. Exit 3 means the source changed: copy the printed backup over it now.

Copy mode runs any command, so it is also the recipe for pytest (FastAPI scopes, AF14):

```bash
node .claude/kit/mutant/mutant.mjs --mode copy --cwd <scope> \
  --file src/<package>/features/orders/service.py \
  --from 'if used + quantity > limit:' --to 'if used + quantity >= limit:' \
  -- uv run python -B -m pytest tests/unit/features/orders -x
```

- `python -B` keeps the mutant's bytecode out of `__pycache__`: a same-size mutant
  restored within the same second would otherwise be loaded again from the stale `.pyc`.
- No `--cov`: a coverage gate on a subset fails the run without a failing test (INVALID).
- KILLED is read from pytest's final summary line (`1 failed, 3 passed in 0.42s`): keep
  the default output or `-q`. A collection error (`1 error in …`) is INVALID.
- Never while `uvicorn --reload` (or any watcher) serves that scope: it would load the
  mutant.

## Reading the result

| Output | Exit | Meaning |
|---|---|---|
| `KILLED` | 0 | the mutant was applied and a test failed on it |
| `SURVIVED` | 1 | every test passed with the mutant: the TEST is wrong — fix it and rerun |
| `INVALID` | 2 | the snippet was not unique, the specs never loaded the file, or the run broke without a failing test (syntax/transform error): fix the mutant, it is neither killed nor survived |
| `SOURCE CHANGED` | 3 | restore from the backup immediately |

Report each mutant as a row: `| Rule | Mutant | Killing test | Result |`, then `N/N killed`.
A mutant that cannot be killed (an equivalent mutant) is listed with the reason.

When done, `node_modules/.kit-mutant/` can be deleted (`rm -rf <scope>/node_modules/.kit-mutant`).
