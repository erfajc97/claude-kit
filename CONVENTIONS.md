# claude-kit conventions (the contract every plugin follows)

This file is the single source of truth for how the kit is built. Every agent, skill, rule
block and template in `plugins/*` follows it. Change it first, then the plugins.

## 1. Packaging

- Marketplace `erfa-kit` (repo `erfajc97/claude-kit`), five plugins:
  - `kit` — core, stack-agnostic: rule blocks for EVERY stack (so one plugin composes any
    CLAUDE.md), structure specs, auditors, workflow skills, templates, the external-skills
    catalogue, opt-in hooks and scripts.
  - `kit-nestjs`, `kit-astro`, `kit-expo` — the stack's builder agent(s) plus the kit's OWN
    knowledge skills (`nestjs-prisma`, `astro-setup`). They hold NO rules: rules live in
    `plugins/kit/skills/kickoff/blocks/`.
  - `kit-design` — `brand-reference` (writes `docs/brand.md` for a project with no brand).
  - Third-party skills are never bundled (§3b.8).
- Invocation is namespaced by plugin: skills `/kit:kickoff`, `/kit:adopt`, `/kit:audit`,
  `/kit:phase-done`; agents `kit:auditor-rules`, `kit-nestjs:api-builder`, etc.
- Plugins cannot auto-load a CLAUDE.md, so the kit WRITES rules into each project's
  `CLAUDE.md` (copied text, works on any PC through git and without the plugin).
- Language: everything in the kit (agents, skills, rules, templates, code) is English.
  End-user UI copy lives in i18n files (es-AR by default, a project parameter).
- No hardcoded project names, paths, people, counts or brands anywhere in the kit. Use the
  parameters in §3 (`kit.json`) or placeholders `{{like_this}}` in templates.

## 2. Rule blocks and IDs

Blocks live in `plugins/kit/skills/kickoff/blocks/<block>.md`:

| Block file | ID prefix | Scope |
|---|---|---|
| `general.md` | `G` | every project |
| `api-common.md` | `A` | any backend |
| `api-nestjs.md` | `AN` | NestJS + Prisma |
| `web-common.md` | `W` | any web front-end |
| `web-astro.md` | `WA` | Astro + React islands |
| `mobile-common.md` | `M` | any mobile app |
| `mobile-expo.md` | `ME` | Expo React Native |
| `addon-tenancy.md` | `T` | multi-tenant SaaS (optional) |
| `addon-money.md` | `$` → use `MO` | money, payments, idempotency, locks (optional) |
| `addon-observability.md` | `OB` | error tracking / analytics / uptime adapters (optional) |
| `addon-ai.md` | `AI` | LLM providers behind one service (optional) |

(`addon-money.md` uses prefix `MO`.) Future blocks: `api-fastapi.md` (`AF`), `web-next.md` (`WN`).

- IDs are **stable and append-only**: `G1, G2…`, `AN1, AN2…`. Never renumber; a retired
  rule stays with `(retired)` in its title. Auditors cite IDs exactly.
- Project-specific rules go in the project's CLAUDE.md under `## Project rules` with prefix
  `P` (`P1, P2…`). The kit never writes or rewrites that section.
- Block file format (exact):

```markdown
<!-- kit:block <block-name> v<N> -->
## Rules — <Title> (`<PREFIX>`)

<PREFIX>1. **<Short title>.** <rule text: the rule, then WHY in one line; then HOW it is
    checked (command, grep, test) when mechanical>.
<PREFIX>2. ...
<!-- /kit:block <block-name> -->
```

- `/kit:adopt --update` replaces text between the markers of a block and never touches
  anything outside them.
- Rules are written so an auditor can check them: concrete, with the command or grep
  when the check is mechanical. Parameters in rules use `{{param}}` and are filled from
  `kit.json` when the block is copied.

### Canonical fake-test list (`FT`)

`G3` (mutation check) refers to the fake-test patterns `FT1…FTn`, defined ONCE in
`general.md` (merged from the three source projects, deduplicated). Every auditor cites
them as `FT<n>`.

## 3. Project configuration: `.claude/kit.json`

Written by `/kit:kickoff` or `/kit:adopt`, committed with the project. Every agent reads it
first.

```json
{
  "kitVersion": "0.1.0",
  "project": "{{name}}",
  "locale": { "code": "en", "ui": "es-AR" },
  "requirements": {
    "source": "docs/prd.md",
    "idScheme": "free text: how requirement ids look, e.g. 'PRD §3.2' or 'R-12'",
    "checklist": "docs/requirements-checklist.md"
  },
  "tracking": "plan",
  "commitStyle": "tags",
  "testRunner": { "web": "vitest", "mobile": "vitest", "api": "vitest" },
  "scopes": {
    "api":    { "stack": "nestjs", "path": "apps/api",    "mode": "enforce" },
    "web":    { "stack": "astro",  "path": "apps/web",    "mode": "report" },
    "mobile": { "stack": "expo",   "path": "apps/mobile", "mode": "off" }
  },
  "addons": ["tenancy", "money"],
  "brand": "docs/brand.md",
  "commands": {
    "api":    { "lint": "", "typecheck": "", "test": "", "build": "" },
    "web":    { "lint": "", "typecheck": "", "test": "", "build": "" },
    "mobile": { "lint": "", "typecheck": "", "test": "" },
    "e2e": ""
  },
  "audit": { "chain": ["rules", "tests", "security", "ux", "challenge"], "milestone": ["judgment", "senior"] },
  "seal": false
}
```

- `tracking`: `"plan"` → `docs/plan.md` + `docs/requirements-checklist.md` + README TODO
  (small / take-home projects). `"backlog"` → `docs/backlog.md` + `docs/progress.md` +
  checklist (multi-week products). Exactly one progress log is the source of truth.
- `commitStyle`: `"tags"` → subject starts with `[ADD] [FIX] [STYLE] [REFACTOR] [TEST]
  [DOCS] [CHORE] [PERF]`; `"conventional"` → `feat(scope): …`. Body: WHY + `Verified:` line.
- `scopes.<area>.mode`:
  - `enforce` — rules apply, builders follow them, auditors BLOCK on findings.
  - `report` — inherited code: auditors report findings in a "Pre-existing" section but
    never block and never ask for migrations; new code in this scope still follows rules.
  - `off` — the scope exists but the kit ignores it (no rules copied, no audit).
  A scope that does not exist in the repo is simply absent.
- `brand`: optional path to a brand reference (tokens, palette, typography, voice). UI
  auditors check against it when present; when absent they only enforce "tokens only".
- `seal`: opt-in enforcement — when `true`, the kit's PreToolUse hook blocks `git commit`
  until `/kit:audit` passed on the staged paths (see §6). Default `false`.

## 4. Agents

Frontmatter:

```yaml
---
name: auditor-rules
description: <when to use it, one or two sentences — this is what the main agent reads to decide>
tools: Read, Grep, Glob, Bash
---
```

- No `model:` key (agents inherit the session model). No `hooks`, `mcpServers`,
  `permissionMode` (ignored in plugin agents).
- Builders: `tools: Read, Write, Edit, Grep, Glob, Bash`. They implement ONE task with TDD
  and the mutation check, **never commit** (git writes are the main agent's), and end with
  the builder report (§5).
- Auditors: `tools: Read, Grep, Glob, Bash`. **Read-only**: never edit project files, never
  touch the git tree (no add/commit/stash/checkout). Mutants run on a temp copy or in
  memory, and the original is verified restored.
- Every agent starts by reading `.claude/kit.json`, the project `CLAUDE.md`, and the files
  `kit.json` points to. If `kit.json` is missing, the agent says so and suggests
  `/kit:adopt`, then works from CLAUDE.md alone.
- Procedure style (from the best source auditor): numbered steps, each with the concrete
  command or Grep pattern to run. "Run it, don't assume." Audit only the paths in scope:
  the diff (`git diff HEAD`, staged + unstaged + untracked) or the paths the caller names.
- Scope awareness: skip `off` scopes; in `report` scopes, findings in files NOT touched by
  the change go to "Pre-existing" and do not count for the verdict.

## 5. Report formats

Auditor report (all auditors except senior):

```markdown
## <auditor-name> — <scope audited>
### Passed
- <check> ✔ (evidence: command/exit code or file:line)
### Findings
| Sev | Rule | File:line | Finding | Fix |
|---|---|---|---|---|
### Pre-existing (not counted)
| Sev | Rule | File:line | Finding |
### Notes for the owner
<deploy / migration / env / OTA implications, only if any>
VERDICT: PASS | FAIL (<n> BLOCKER, <m> HIGH)
```

- Severities: `BLOCKER` (wrong behaviour, data loss, security hole, requirement MUST
  unmet, rule broken in a way users or data feel) · `HIGH` (rule broken, missing test for
  a rule, fake test) · `MEDIUM` (maintainability, missing edge test) · `LOW` (polish).
- `FAIL` iff any BLOCKER or HIGH counts. "Don't inflate": a finding without a concrete
  consequence is at most LOW.
- `auditor-senior` is advisory: up to 8 improvements ranked by impact/effort (S/M/L),
  risks, up to 5 strengths, and `VERDICT: ADVISORY`.

Builder report:

```markdown
## <builder> — <task id/title>
- Files: created/changed
- Tests: red → green evidence, counts
- Mutation: <rule> → <mutant> → <killing test> (table), "N/N killed"
- Commands run + exit codes (lint, typecheck, test, build)
- Deviations / open questions (never invent: ask)
```

## 6. Workflow

- `/kit:kickoff` (new repo) and `/kit:adopt` (existing repo) → write `kit.json`, compose
  `CLAUDE.md`, add the tracking docs, never migrate existing code.
- Per task: builder → audit chain (`kit.json` `audit.chain`, only for scopes touched) →
  builder fixes → re-audit only what failed → commit (main agent) → tick the progress log.
- Milestones: `auditor-judgment` + `auditor-senior`.
- `/kit:audit [paths]` runs the chain and prints the merged verdict. `/kit:phase-done`
  re-runs it, drafts the commit message in `commitStyle`, and ticks the progress log.
- Seal (opt-in, `seal: true`): after a PASS, `/kit:audit` writes
  `.claude/kit-seal.json` = `{ "paths": [...], "sha256": {path: hash}, "verdict": "PASS",
  "at": ISO }`. The kit's PreToolUse hook (node, cross-platform) blocks `git commit` when
  a staged file is missing from the seal or its hash changed. With `seal: false` or no
  `kit.json`, the hook is a no-op — it must never affect a project that did not opt in.

## 3b. Amendments (v0.1 reconciliation — these override §2–§3 where they differ)

1. **Placeholders**: `{{dotted.path}}` = a raw kit.json value (`{{locale.ui}}`,
   `{{scopes.web.path}}`, `{{commands.api.test}}`, `{{rigor}}`, `{{coverage}}`).
   snake_case `{{derived_name}}` only for values the kickoff/adopt skill computes; each one
   is listed in the skill's param table. `{{ui_locale}}` → `{{locale.ui}}`.
2. **Scopes are named and typed**, so a repo can hold several apps of one kind:
   `"scopes": { "api": {"kind": "api", "stack": "nestjs", "path": "apps/api", "mode":
   "enforce", "validator": "nestjs-zod"}, "admin": {"kind": "web", "stack": "astro", ...},
   "landing": {"kind": "web", "stack": "astro", ...}, "app": {"kind": "mobile", "stack":
   "expo", ...} }`. Blocks are chosen by `kind` (→ `*-common`) and `stack` (→ stack block),
   each copied once. `commands` is keyed by scope name. Placeholders that point into a scope
   use the scope name (`{{scopes.<name>.path}}`); blocks that need "the" path of a kind say
   "every scope of kind web" instead.
3. **New kit.json keys**: `"coverage": 90` (G2 gate, per project), `scopes.<api>.validator`
   (`nestjs-zod` default | `class-validator`), `commands.<scope>.integration` (optional),
   `commands.<mobile scope>.build` optional (`"n/a"` allowed).
4. **No duplicate rules across blocks**: addons hold only what is specific to them and point
   to base rules (`see A10`, `see AN6`) instead of restating them. IDs are unpublished, so
   renumbering is allowed until v0.1.0 ships.
5. **Shared mutation recipe**: kickoff/adopt copy `templates/mutant/` (the in-memory Vitest
   transform-plugin config + the copy-and-restore fallback with sha256 check) into the
   project at `.claude/kit/mutant/`. Builders and `auditor-tests` use that copy instead of
   embedding the recipe.
6. **Builder report** (§5) gains a `Notes for the owner` bullet (deploy order, OTA vs native
   build, env, visual check).
7. **Blocks**: a blank line between rules (Markdown renders them as separate paragraphs).
8. **No third-party skills are bundled.** The kit ships only its own skills. Every
   third-party skill is an external dependency listed in
   `plugins/kit/skills/kickoff/external-skills.json` (`name, purpose, useWhen, source,
   install, update, checkPath, license, usedBy`). kickoff/adopt check `checkPath` on the
   current machine and offer `install` (or `update` on `--update`) after the user confirms.
   Agents in `usedBy` read the installed `SKILL.md` as extra guidance; kit rules win on any
   conflict; a missing skill is one "Notes for the owner" line, never a failure.
9. **`report` mode, precisely**: new files and added lines count for the verdict in every
   mode; older lines of a touched file are "Pre-existing" in every mode; `--all` censuses
   count everything in `enforce` scopes and put all `report` findings in Pre-existing.
10. **Evidence tables** (criterion → test matrix, mutation table, endpoint table) may sit
   inside `### Passed`.
11. **Seal details**: the hook matcher is `Bash|PowerShell`; with the seal on, stage and
   commit are two separate commands (`git add … && git commit`, `commit -a`, `--only` and
   pathspecs are refused); `.claude/kit-seal.json` and `.claude/kit-audit-state.json` are
   git-ignored (kickoff/adopt add them).
12. **kit.json**: `testRunner` may be keyed by scope name (falls back to kind);
   `trackingDocs` (optional) maps tracking roles to existing file names, so adopt keeps a
   project's own doc names. `header` and `commands` in CLAUDE.md are pseudo-blocks with
   their own markers, refreshed by `--update`. Structure specs select scopes with
   `appliesTo.kind`; projects add their own in `.claude/kit-structure/`.

## 6b. Rigor levels and audit modes

`kit.json` gains `"rigor": "full" | "standard" | "lite"` (default `"standard"`):

| Rigor | When | Builders | Audit after each task (automatic) | Milestones |
|---|---|---|---|---|
| `full` | long-lived products | TDD + mutation check | the whole `audit.chain` | judgment + senior |
| `standard` | normal projects | TDD + mutation check | `rules` + `tests` only; others on demand | on demand |
| `lite` | throwaway / quick fixes | tests where cheap, no mutation check | `quick` only (architecture) | none |

- "Automatic" = the composed CLAUDE.md contains a rule (in `general.md`, parameterised by
  `{{rigor}}`) telling the main agent to run `/kit:audit` with the level's chain after every
  finished task and before every commit. With `seal: true` the hook also enforces it.
- `/kit:audit quick` — architecture only, any rigor: runs `scripts/arch-check.mjs` (node,
  zero LLM tokens) and prints its findings in the §5 format with `VERDICT`. No agent is
  spawned unless the user passes `--explain`.
- `/kit:audit` — the chain for the project's rigor. `/kit:audit full` — the whole chain
  regardless of rigor.
- `arch-check.mjs` is driven by machine-readable structure specs next to each block:
  `blocks/<block>.structure.json` (folder layout per scope, allowed files at a feature
  root, forbidden imports between layers/features, file-name patterns). It reads
  `kit.json` scopes (paths, modes) and checks only changed files by default (`--all` for a
  whole-repo census; findings in `report` scopes go to "Pre-existing").
- In `lite`, CLAUDE.md still carries `general.md` and the stack blocks, but the lite profile
  marks which rules are enforced (architecture + secrets + no dead code); the rest are
  guidance. The composed CLAUDE.md states this plainly at the top.

## 7. Defaults

- Test runner: Vitest (web, mobile and NestJS). Jest only when a project already uses it.
- Web: Astro + React islands, TanStack Query, HeroUI, Tailwind v4, react-hook-form + zod.
- API: NestJS + Prisma, zod DTOs (nestjs-zod), hand-written migrations.
- Mobile: Expo + Expo Router, TanStack Query, SecureStore for secrets.
- E2E: Playwright (web).
- Machine notes (Windows, rtk proxy) are NOT part of the kit; they belong in the user's
  global settings or the project block.
