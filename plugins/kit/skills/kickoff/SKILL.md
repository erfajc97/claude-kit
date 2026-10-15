---
name: kickoff
description: Set up the claude-kit harness in a NEW repository. Asks one round of questions (project, scopes with kind/stack/path, requirements source, tracking, commit style, rigor, addons, brand, UI locale), then writes .claude/kit.json, composes CLAUDE.md from the rule blocks, adds the tracking docs, the mutation recipe and .claude/settings.json. Use for /kit:kickoff. For a codebase that already has code or a CLAUDE.md, use /kit:adopt instead.
argument-hint: "[project name]"
---

# /kit:kickoff — a new repository

You compose the project's engineering harness from the kit. You never write application
code, never commit (the user or the main agent commits when asked), and never overwrite a
file that already exists without asking.

**Paths.** Everything here is relative to THIS skill's folder (the base directory shown when
the skill loads): `blocks/`, `templates/`, `external-skills.json`. The kit plugin root is
`../../` from here: `../../.claude-plugin/plugin.json` (version), `../../scripts/`
(`arch-check.mjs`, `seal-write.mjs`). In shell commands use the absolute form of these
paths.

## 1. Preflight (read-only)

```bash
git rev-parse --show-toplevel        # must be a git repo; if not, ask before `git init`
ls .claude/kit.json CLAUDE.md AGENTS.md 2>/dev/null
git ls-files | head -50
```

- `.claude/kit.json` exists → stop: "already set up — use `/kit:adopt --update`".
- A `CLAUDE.md` or application code already exists → this is an existing codebase: say so
  and recommend `/kit:adopt` (it keeps the project's rules). Continue only if the user
  insists; then back up the old `CLAUDE.md` to `.claude/CLAUDE.pre-kit.md` before writing.
- Read the kit version: `version` in `../../.claude-plugin/plugin.json`.

## 2. Ask everything in ONE round

Send one message with these questions, each with its default, and wait for the answers.
Accept "defaults" for any of them.

1. **Project name** (default: the folder name, or the skill argument).
2. **Scopes** — one line per app: `name · kind · stack · path`. Kinds: `api`, `web`,
   `mobile`. Stacks with a dedicated block: `nestjs` (api, default) and `fastapi` (api),
   `astro` (web), `expo` (mobile); any other stack gets only the kind's common block.
   Several apps of one kind are fine (`web`, `admin`, `landing`). For a `nestjs` api: the
   validator (`nestjs-zod` default | `class-validator`). Default: `api · api · nestjs ·
   apps/api`, `web · web · astro · apps/web`, `mobile · mobile · expo · apps/mobile` —
   keep only what exists.
3. **Requirements source** — the PRD, the PDF statement or the client brief (a path; a file
   outside the repo is copied into `docs/`), and how its IDs look (`R-12`, `PRD §3.2`,
   `DOC-03`). "Later" is allowed: then `docs/prd.md` is created empty.
4. **Tracking** — `plan` (small or take-home: `docs/plan.md` + checklist + README TODO) or
   `backlog` (multi-week product: `docs/backlog.md` + `docs/progress.md` + checklist).
5. **Commit style** — `tags` (`[ADD] [FIX] …`) or `conventional` (`feat(ID): …`).
6. **Rigor** — `full` (long-lived product: whole audit chain after every task, milestones),
   `standard` (default: rules + tests after every task, the rest on demand) or `lite`
   (throwaway / quick fix: architecture-only quick audit, tests where cheap).
7. **Addons** — any of `tenancy` (multi-tenant SaaS), `money` (payments, balances,
   idempotency), `observability` (Sentry / PostHog / Better Stack style adapters), `ai`
   (LLM providers behind one service).
8. **Brand reference** (only if there is a `web` or `mobile` scope) — (a) a path to an
   existing brand doc or token file, (b) create one with `/kit-design:brand-reference`
   (adds the `kit-design` plugin), or (c) none for now (UI audits then enforce "tokens
   only").
9. **UI locale** for end-user copy (default `es-AR`).
10. **Commands** per scope — lint, typecheck, test, integration (api), build (`n/a` allowed
    for mobile) — or "fill later"; test runner per scope (default `vitest`; `pytest` for a
    `fastapi` scope). Defaults for a `fastapi` scope (run from its path, AF11):
    lint `uv run ruff check . && uv run ruff format --check .`, typecheck `uv run mypy`,
    test `uv run pytest --cov`, integration `uv run pytest tests/integration` (Docker up),
    build `n/a` or the image build.
11. **Seal** — block `git commit` until the audit passed on the staged files? (default no).
12. **Coverage gate** (default 90 %).

## 3. Write `.claude/kit.json`

Start from `templates/kit.json`; set every answered value; drop the example scopes that do
not exist; `commands` and `testRunner` are keyed by scope name; omit `brand` when there is
none (option b sets it later); `kitVersion` = the plugin version. Validate:

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/kit.json','utf8')); console.log('kit.json ok')"
```

## 4. Compose `CLAUDE.md`

**4.1 Choose the blocks** (Glob `blocks/*.md`; `structure-spec.md` is not a block):

1. `general.md` — always.
2. For every scope whose mode is `enforce` or `report`: `<kind>-common.md`, then
   `<kind>-<stack>.md` if it exists. Each block is copied ONCE even when several scopes
   share a kind or stack. Order: api, web, mobile.
3. `addon-<name>.md` for each addon, in the order tenancy, money, observability, ai.

**4.2 Fill the parameters** in every block and template (table below). After filling, no
`{{` may remain in `CLAUDE.md`.

**4.3 Report-mode note.** Before a kind's blocks, outside the markers, when some scope of
that kind is in `report` mode, add one line:
`> Report mode: <name> (<path>) — findings on existing code are listed as pre-existing and never block; new code follows these rules.`

**4.4 Assemble** in this exact order, from `templates/CLAUDE.md`:
1. the `header` block (kit version, rigor statement, scopes table);
2. `general`;
3. the scope blocks;
4. the addon blocks;
5. `## Project rules` — empty (the comment of the template only);
6. the `commands` block, generated from `kit.json` `commands`.

Separate blocks with one blank line. Keep every `<!-- kit:block … -->` marker exactly as
in the block file.

**4.5 Validate**

- Grep `\{\{` in `CLAUDE.md` → 0 hits.
- Count `<!-- kit:block ` and `<!-- /kit:block ` → equal.
- Rule IDs unique: Grep `^[A-Z]{1,2}\d+\. \*\*` in `CLAUDE.md` and check no ID repeats.

### Parameter table

**Dotted** `{{a.b.c}}` = the raw value at that path of `kit.json` (`{{locale.ui}}`,
`{{requirements.source}}`, `{{requirements.idScheme}}`, `{{rigor}}`, `{{coverage}}`,
`{{brand}}`, `{{scopes.<name>.path}}`, `{{commands.<name>.test}}`, `{{testRunner.<name>}}`).

- If the segment after `scopes.`, `commands.` or `testRunner.` is a **kind** rather than a
  scope name (blocks say `{{scopes.web.path}}`, `{{commands.api.test}}`): use every scope of
  that kind — one scope → its value; several → `` `apps/web` (web), `apps/admin` (admin) ``.
- An empty command → `` the `<cmd>` command in `.claude/kit.json` (not configured yet) ``.
- `{{scopes.<api>.validator}}` absent → `nestjs-zod`. `{{brand}}` absent → `none`.

**Derived** (snake_case, computed here):

| Param | Value |
|---|---|
| `{{project}}` | `project` |
| `{{kit_version}}` | `kitVersion` |
| `{{task_doc}}` | plan → `docs/plan.md`; backlog → `docs/backlog.md` |
| `{{tracking_docs}}` | plan → `` `docs/plan.md`, `<checklist>` and the README "Progress (TODO)" list ``; backlog → `` `docs/backlog.md`, `docs/progress.md` and `<checklist>` `` |
| `{{progress_log}}` | plan → `the README "Progress (TODO)" list`; backlog → `` `docs/progress.md` `` |
| `{{commit_format}}` | tags → `` the subject starts with `[ADD]`, `[FIX]`, `[STYLE]`, `[REFACTOR]`, `[TEST]`, `[DOCS]`, `[CHORE]` or `[PERF]`, then the task ID ``; conventional → `` Conventional Commits with the task ID as scope (`feat(<ID>): …`, `fix(<ID>): …`) `` |
| `{{rigor_statement}}` | see below |
| `{{scopes_table}}` | one row per scope: `` \| <name> \| <kind> \| <stack> \| `<path>` \| <mode> \| `` |
| `{{addons_list}}` | `tenancy (T), money (MO)…` or `none` |
| `{{brand_line}}` | `` `<brand>` — UI audits check colors, typography and voice against it `` or `none — UI audits enforce "tokens only"` |
| `{{commands_section}}` | per scope: `### <name> (<path>)` + a `bash` block with each non-empty command and a comment (`# lint`); then `e2e` if set |
| `{{auditors_list}}` | full → `rules, tests, security, ux and challenge after every task; judgment and senior at milestones`; standard → `rules and tests after every task; security, ux and challenge on demand`; lite → `the architecture quick audit after every task` |
| `{{blocks}}` | the assembled blocks |

`{{rigor_statement}}`:
- **full** — "After every finished task and before every commit the main agent runs
  `/kit:audit` (the whole audit chain) without being asked; milestones add judgment and
  senior. Every rule below is enforced."
- **standard** — "After every finished task and before every commit the main agent runs
  `/kit:audit` (rules + tests) without being asked; security, ux and challenge run with
  `/kit:audit full`. Every rule below is enforced."
- **lite** — "Quick profile. ENFORCED: the architecture rules of the scope blocks (checked by
  `/kit:audit quick`), G9 (secrets) and G4 (no dead code). Every other rule below is
  GUIDANCE. After every finished task and before every commit the main agent runs
  `/kit:audit quick`; tests where cheap, no mutation check."

## 5. Tracking and project docs

Create from `templates/`, filling the parameters; NEVER overwrite an existing file (report
it instead):

| Tracking | Files |
|---|---|
| plan | `docs/plan.md`, `<checklist>` (`requirements-checklist.md`), and the two sections of `README-sections.md` appended to `README.md` (created with `# <project>` if missing) |
| backlog | `docs/backlog.md`, `docs/progress.md`, `<checklist>` |
| always | `docs/quality-standard.md`; `docs/adr/TEMPLATE.md` from `adr.md` with `{{number}}` → `NNNN`, `{{title}}` → `<title>`, `{{date}}` → `<YYYY-MM-DD>` |

- Requirements source outside the repo → copy it into `docs/` and point `kit.json` at the
  copy. "Later" → create `docs/prd.md` with a one-line placeholder heading.
- Brand option (a) → set `brand` to the given path. Option (b) → after this skill, tell the
  user to run `/kit-design:brand-reference` (it writes `docs/brand.md` and sets `brand`).
  If they prefer to fill it by hand, copy `templates/brand.md` to `docs/brand.md` and set
  `brand`.

## 6. Mutation recipe

Copy `templates/mutant/` (`vitest.mutant.config.mts`, `mutant.mjs`, `RECIPE.md`) to
`.claude/kit/mutant/` in the project. Builders and `auditor-tests` use that copy (G3).

## 7. `.gitignore`

Append the kit's local state files if absent (one per line):

```
.claude/kit-seal.json
.claude/kit-audit-state.json
```

## 8. `.claude/settings.json`

Merge (never drop existing keys or hooks) with `templates/settings.json`:

- `extraKnownMarketplaces.erfa-kit` = `{ "source": { "source": "github", "repo": "erfajc97/claude-kit" } }`;
- `enabledPlugins`: `kit@erfa-kit` always; `kit-nestjs@erfa-kit` if a scope's stack is
  `nestjs`; `kit-astro@erfa-kit` if `astro`; `kit-expo@erfa-kit` if `expo`;
  `kit-design@erfa-kit` ONLY when the user chose brand option (b) or asked for it.
  `fastapi` has rules (`AF`) and audits but no builder plugin yet: say so in the hand-over;
  the main agent builds those tasks itself, following `AF` and `A`.

Validate with `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`.

## 9. External skills

The kit bundles no third-party skills, so every machine gets the latest upstream version.
Read `external-skills.json` in this skill's folder (`{ skills: [{ name, purpose, useWhen:
{ kind, stack }, source, install, update, checkPath, license, usedBy, note? }] }`;
`usedBy` names the kit agents and builders that apply the skill when it is installed). If
the file does not exist, say "no external skill list in this kit version" and skip.

For each entry whose `useWhen` matches a scope of `kit.json` (`kind` and `stack` may be a
string, a list or `*`; a missing field matches anything), with these filters:

- `optional: true` → list it last, under "optional", and never pre-select it.
- `useWhen: {}` with `turborepo-monorepo` → offer it only when the repo is a monorepo
  (`pnpm-workspace.yaml`, `turbo.json`, or a root `package.json` with `workspaces`).
- Entries whose `usedBy` names only `kit-design:*` agents or skills → offer them only when
  the user chose `kit-design` (no brand reference yet) or it is already enabled.
- Skip `off` scopes when matching.

1. Expand `checkPath` (`~` = the home folder) and test it: `ls -d <path>`.
2. Present → "installed ✔".
3. Missing → list name, purpose, license, source and the exact `install` command.

Show the list once (name · purpose · used by · status) and ask which to install. Run an
install command ONLY after the user confirms it; never install silently, never from a
source that is not the entry's. Skills are per machine: a teammate gets the same offer when
they run `/kit:adopt --update` on their PC. A missing skill never blocks anything — the
auditors that use it add one "not installed" note and run without it.

## 10. Verify and hand over

```bash
node "<kit>/scripts/arch-check.mjs" --all; echo "exit=$?"   # the empty skeleton must PASS
```

Then report to the user:

- the files created (and the ones left untouched because they existed);
- the scopes, rigor and addons in force;
- next steps: commit the setup when they ask (`git add -- <files>` then `git commit -F …`,
  two commands), run `/kit-design:brand-reference` if chosen, install the stack plugins
  the settings enable (`/plugin install …@erfa-kit` if not yet installed), and start task
  F0 of the plan.
