---
name: adopt
description: Bring an EXISTING codebase under the claude-kit harness without touching its code - detects scopes and stacks, reads the current CLAUDE.md and .claude/agents, asks which scopes to enforce, report or turn off, writes .claude/kit.json, rebuilds CLAUDE.md with the kit blocks and the project's own rules as P rules (with an old ID → new ID mapping), and offers a first audit. `/kit:adopt --update` refreshes only the kit-owned text between block markers. Use for /kit:adopt.
argument-hint: "[--update]"
---

# /kit:adopt — an existing repository

The project already has code, conventions and maybe its own agents. You fit the kit around
them. You **never migrate or refactor code**, **never delete or move the project's agents,
skills or hooks**, never commit, and never lose a line of the old `CLAUDE.md`.

**Paths.** Relative to THIS skill's folder: the kickoff skill is `../kickoff/` (its
`blocks/`, `templates/`, `external-skills.json` and its parameter table in
`../kickoff/SKILL.md` §4); the kit plugin root is `../../` (`.claude-plugin/plugin.json`,
`scripts/arch-check.mjs`). Read `../kickoff/SKILL.md` sections 4–9 now: adopt reuses them.

With `--update`, skip to **Update mode** at the end.

## 1. Detect (read-only)

```bash
git rev-parse --show-toplevel && git status --short | head -20
ls CLAUDE.md AGENTS.md .claude/kit.json .claude/settings.json .husky 2>/dev/null
ls .claude/agents .claude/skills .claude/hooks 2>/dev/null
git ls-files '*package.json' '*pyproject.toml' '*app.json' '*app.config.*'
git log --format=%s -40
```

- `.claude/kit.json` already exists → offer `--update` instead.
- A dirty tree → warn that adopt rewrites `CLAUDE.md` and `.claude/settings.json`; suggest
  committing first, but continue if the user says so (a backup is made anyway).

**Scopes.** For each package folder (Read its manifest):

| Signal in dependencies / files | kind · stack |
|---|---|
| `@nestjs/core` | api · nestjs (validator: `nestjs-zod` if present, else `class-validator`) |
| `fastapi` (pyproject) | api · fastapi |
| `express`, `fastify`, `hono`, `koa` | api · that name |
| `astro` | web · astro |
| `next` | web · next |
| `vite` + `react` (no astro/next) | web · react-vite |
| `expo` | mobile · expo |
| `react-native` without `expo` | mobile · react-native |

Scope name = the folder name (`apps/admin` → `admin`); path = the folder. Commands from its
scripts (`lint`; `typecheck`/`check-types`/`tsc`; `test`; `test:integration`/`test:int`;
`build`), test runner from dependencies (`vitest`, `jest`, `pytest`). A single-package repo
has one scope with path `.`.

**Everything else.**
- Requirements: Glob `docs/**/*.pdf`, `docs/**/prd*.md`, `**/PRD.md`, `contexto/**`; a
  checklist: `docs/*checklist*.md`.
- Tracking already in use: `docs/plan.md`, `docs/backlog.md`, `docs/progress*.md` or a
  progress log under another name, a README "Progress"/"TODO" section. Never rename them.
- Commit style: count subjects matching `^\[(ADD|FIX|STYLE|REFACTOR|TEST|DOCS|CHORE|PERF)\]`
  vs `^\w+(\([^)]+\))?!?: `.
- Addon hints: Grep schemas/migrations for `organization_?id|organizationId|tenant_?id` →
  tenancy; `Decimal|payment|payout|idempoten` → money; dependencies `@sentry/`, `posthog`,
  `@logtail` → observability; `openai`, `@anthropic-ai/sdk`, `@google/genai` → ai.
- Brand: Glob `docs/brand*.md`, `**/design-tokens/**`, `.impeccable.md`, `docs/design/**`,
  `**/tokens.css`.
- Mutation/quality docs the project already has (`docs/estandar*`, `docs/quality*`).

**The old rules.** Read `CLAUDE.md` (and `AGENTS.md`) entirely. Extract every rule: numbered
or ID'd items (`N1.`, `G3.`, `A8b.`, `14b.`, `**Rule 5**`), and imperative bullets
("never", "always", "must"). Keep each rule's ID, title and full text.

## 2. Ask everything in ONE round

Show what you detected as a table (scope · kind · stack · path · commands), then ask, with
defaults:

1. **Mode per scope** — `enforce` (rules apply, auditors block), `report` (inherited code:
   findings on old code are listed, never block; new code follows the rules) or `off` (the
   kit ignores it). Example: "mobile enforce, api report, web off". Default: `report` for
   scopes with code, `enforce` for empty ones.
2. **Rigor** — `full` | `standard` (default) | `lite` (see `../kickoff/SKILL.md` §2.6).
3. **Requirements source** and its ID scheme (confirm the detected one).
4. **Tracking** — confirm the docs detected; they keep their names.
5. **Commit style** — confirm the detected one.
6. **Addons** — confirm the hints.
7. **Brand** (if a web or mobile scope exists): the detected reference, or (a) a path,
   (b) create one with `/kit-design:brand-reference`, (c) none.
8. **UI locale**, **coverage gate** (keep the project's if it has one), **seal** (default
   no), and the **commands** you could not detect.
9. **Rule conflicts** found in step 3 (if any): which wins.
10. **First audit** — (a) `/kit:audit quick --all` (zero tokens, recommended), (b) the full
    chain over the whole repo (costly: every auditor reads the whole codebase), (c) none.

## 3. Map the old rules

For each extracted rule decide ONE of:

- **Covered** — a kit rule says the same (same intent and check). Map `old → kit ID`
  (e.g. `G3 → G3`, `N1 → T1, T2`, `A2 → A7, AN3`, "useEffect last resort" → `W3`).
- **Partly covered** — keep the project-specific remainder as a `P` rule and map
  `old → kit ID + Pn`.
- **Project-specific** — becomes `P<n>` (numbered in order of appearance), text copied
  verbatim, keeping its Why/Check if it had them. Project facts that are rules (ports,
  domains, brand spelling, platform quirks) are `P` rules too.
- **Conflicting** — the old rule contradicts a kit rule (e.g. a different commit style or
  test runner). Do not drop it: ask (question 9). If the project's rule wins, it becomes a
  `P` rule that says "overrides <kit ID> in this project".

Non-rule sections (repo map, ports, commands, auth flow, known traps, glossaries) are kept
verbatim under `### Project context`.

## 4. Write the files

1. Back up: copy `CLAUDE.md` to `.claude/CLAUDE.pre-kit.md` (and `AGENTS.md` to
   `.claude/AGENTS.pre-kit.md` if it exists). Tell the user they can delete the backups
   after review.
2. `.claude/kit.json` — as kickoff §3, with the answers. Tracking docs keep their real
   names: the derived params (`{{task_doc}}`, `{{tracking_docs}}`, `{{progress_log}}`)
   point at the files that exist.
3. `CLAUDE.md` — as kickoff §4 (blocks chosen by kind and stack for `enforce` and `report`
   scopes, each copied once; report-mode notes; parameters filled), but `## Project rules`
   is not empty:

   ```markdown
   ## Project rules

   P1. **<title>.** <text as in the old CLAUDE.md>

   P2. …

   ### Mapping from the previous CLAUDE.md

   | Old | Title | Now | Note |
   |---|---|---|---|
   | G3 | Mutation check | G3 | same rule |
   | N1 | Tenant isolation | T1, T2 + P4 | RLS details kept in P4 |

   ### Project context

   <repo map, ports, traps… verbatim>
   ```

   The kit writes this section ONCE, now; afterwards it never touches it.
4. Run kickoff §4.5 validation, plus: every old rule appears in the mapping table (count
   them).
5. Kickoff §6 (copy the mutation recipe to `.claude/kit/mutant/`), §7 (`.gitignore`
   entries), §8 (merge `.claude/settings.json`, keeping every existing hook, permission and
   plugin), §9 (external skills, install only on confirmation). Tracking docs that do not
   exist yet are created from the templates (kickoff §5); existing ones are never touched.
6. Brand option (b) → tell the user to run `/kit-design:brand-reference` next and enable
   `kit-design@erfa-kit` in the settings.

## 5. The project's agents

List every file in `.claude/agents/` with the kit agent that covers it. Never delete, move
or edit them; the user decides.

| Project agent | Kit replacement | Notes |
|---|---|---|
| `auditor-rules` | `kit:auditor-rules` | same role |
| `auditor-<x>` (one big auditor) | `kit:auditor-rules` + `kit:auditor-tests` + `kit:auditor-security` | its project-specific checks may become `P` rules or `.claude/kit-structure/*.structure.json` checks |
| `auditor-integrations` | `kit:auditor-rules` with the `observability` addon (OB) | keep it if it covers project-specific providers |
| `api-builder` | `kit-nestjs:api-builder` | |
| `web-builder` | `kit-astro:web-builder` | |
| `qa-e2e` | `kit-astro:qa-e2e` | |
| `mobile-builder` | `kit-expo:mobile-builder` | |
| anything else | — | keep |

Explain that two agents with the same role both run if both are invoked; the user can
delete the project's copy once the kit's is trusted. Existing hooks (`.husky/`,
`.claude/hooks/`, settings hooks) stay; mention any that overlaps the kit seal.

## 6. First audit (optional)

- (a) `/kit:audit quick --all` — the structure census; in `report` scopes every finding is
  pre-existing.
- (b) `/kit:audit full --all` — after an explicit token-cost warning.
- Findings of a first audit are NOT a to-do list for this session: summarize them and
  suggest turning the top ones into tasks or `quality-standard` entries.

## 7. Hand over

Report: the scopes and modes, rigor, addons, the rules mapping summary (covered / partly /
project / conflicts), files written and backups made, agents table, external skills,
the first-audit result, and next steps (review the diff with `git diff`, commit when they
ask, two commands: `git add -- <files>` then `git commit -F <file>`).

## Update mode (`/kit:adopt --update`)

Refreshes the kit-owned text after the kit plugin was updated or `kit.json` changed. It
never touches anything outside `<!-- kit:block … -->` … `<!-- /kit:block … -->`.

1. Read `.claude/kit.json` and the plugin version (`../../.claude-plugin/plugin.json`).
2. Compute the blocks `kit.json` requires now (kickoff §4.1) with filled parameters.
3. In `CLAUDE.md`, for every marker pair present: replace the text between the markers with
   the current block (the `header` and `commands` blocks are regenerated from `kit.json`).
4. A required block that is missing (a new scope kind, stack or addon): insert it with its
   markers at its place in the order general → api → web → mobile → addons, before
   `## Project rules`.
5. A block present but no longer required (a scope turned `off` or removed, an addon
   dropped): ask before removing it.
6. Refresh `.claude/kit/mutant/` from `../kickoff/templates/mutant/`.
7. Set `kitVersion` in `kit.json` to the plugin version.
8. External skills (`../kickoff/external-skills.json`, as kickoff §9) for the scopes in
   `kit.json`: list each matching entry as installed or missing. Offer the `install`
   command for the missing ones and the `update` command for the installed ones; run each
   only after the user confirms. This is also how a new machine catches up.
9. Validate (kickoff §4.5) and show `git diff --stat` plus a summary of which blocks changed
   and which rule IDs were added or retired.
