# claude-kit

A reusable engineering harness for [Claude Code](https://claude.com/claude-code): the
non-negotiable rules, the builder agents, the read-only auditors and the daily workflow that
turn "the agent wrote it" into "the agent wrote it, proved it with tests that bite, and an
independent auditor signed it off". It works for new projects and for codebases that already
exist, with NestJS, Astro + React and Expo out of the box.

What it gives a project:

- **Rules in `CLAUDE.md`, by ID.** Composed from blocks: general (`G`: TDD, mutation check,
  no dead code, secrets, i18n, one rule in one place…), per stack (`A`/`AN` API and NestJS,
  `W`/`WA` web and Astro, `M`/`ME` mobile and Expo) and optional addons (`T` multi-tenancy,
  `MO` money, `OB` observability, `AI` LLM providers). The text is copied into the project,
  so it works on any machine, even without the plugin.
- **Read-only auditors**: `auditor-rules`, `auditor-tests` (coverage, mutants, the 22
  fake-test patterns), `auditor-security` (per-endpoint protection table), `auditor-ux`
  (360/1280 px, phones, a11y, i18n, brand), `auditor-challenge` (every requirement with
  evidence), `auditor-judgment` (domain decisions) and `auditor-senior` (advisory).
- **A zero-token architecture check** (`/kit:audit quick`) driven by machine-readable
  structure specs: layers, feature layout, forbidden imports, secrets, dead code.
- **Builders per stack** (`kit-nestjs`, `kit-astro`, `kit-expo`) that work test-first and
  never commit.
- **An opt-in seal**: a hook that blocks `git commit` until the audit passed on exactly the
  staged files.

## Install (any PC)

The repository is private, so git needs your GitHub credentials first:

```bash
gh auth login        # once per machine
gh auth setup-git    # lets git (and Claude Code) clone private repos with those credentials
```

**Desktop app:** `+` → **Plugins** → add the marketplace `erfajc97/claude-kit`, then
install `kit` and the stack plugins you use.

**CLI** (inside Claude Code):

```text
/plugin marketplace add erfajc97/claude-kit
/plugin install kit@erfa-kit
/plugin install kit-nestjs@erfa-kit     # NestJS + Prisma API
/plugin install kit-astro@erfa-kit      # Astro + React islands web
/plugin install kit-expo@erfa-kit       # Expo React Native
/plugin install kit-design@erfa-kit     # optional: design skills and the brand reference
```

A project set up by the kit also carries `.claude/settings.json` with the marketplace and
the plugins it needs, so a teammate who opens the repo is offered the same plugins.

## Start

| Situation | Command | What it does |
|---|---|---|
| New project | `/kit:kickoff` | One round of questions → `.claude/kit.json`, `CLAUDE.md`, tracking docs (`plan` or `backlog`), the mutation recipe, `.claude/settings.json` |
| Existing project | `/kit:adopt` | Detects scopes and stacks, asks per scope `enforce` / `report` / `off`, rebuilds `CLAUDE.md` with the kit blocks and moves the project's own rules to `## Project rules` (`P1…`) with an old → new ID map. Never touches code, never deletes the project's agents |

`/kit:adopt` is the key case for real codebases. Example: "mobile `enforce`, api and web
`report`" — new mobile code is held to every rule; old api and web code is reported as
pre-existing and never blocks, while new code there still follows the rules.

## The daily loop

```text
task → builder (TDD + mutation check, never commits)
     → /kit:audit        the audit of the project's rigor (runs automatically after every task)
     → builder fixes     → /kit:phase-done  (re-runs only what failed, ticks the progress log,
                                             drafts the commit message with a Verified: line)
     → the main agent commits:  git add -- <paths>   then   git commit -F .git/KIT_COMMIT_MSG
```

`/kit:audit quick` checks architecture, secrets and dead code with zero LLM tokens.
`/kit:audit full` runs every auditor. `/kit:audit --milestone` adds judgment and senior.
Auditors run in parallel when independent; the skill tells you the token cost before it
starts them.

## Modes and rigor

**Scope modes** (`kit.json` → `scopes.<name>.mode`):

| Mode | Meaning |
|---|---|
| `enforce` | the rules apply, builders follow them, auditors block on findings |
| `report` | inherited code: findings on existing code go to "Pre-existing" and never block; new code follows the rules |
| `off` | the scope exists but the kit ignores it (no rules copied, no audit) |

**Rigor** (`kit.json` → `rigor`):

| Rigor | After each task | Milestones |
|---|---|---|
| `full` | the whole audit chain | judgment + senior |
| `standard` (default) | rules + tests; the rest on demand | on demand |
| `lite` | `quick` only (architecture, secrets, dead code); other rules are guidance | none |

**Seal** (`kit.json` → `"seal": true`, off by default): after a PASS, `/kit:audit` writes
`.claude/kit-seal.json`; the kit's hook then blocks `git commit` while a staged file is
missing from the seal or changed after it. Projects without `kit.json` or with the seal off
are never affected.

## External skills

The kit bundles no third-party skills (design, accessibility, SEO, Tailwind, Prisma,
Expo…), so you always run their latest upstream version. They are listed, with their
source, license and install/update commands, in
`plugins/kit/skills/kickoff/external-skills.json`.

- `/kit:kickoff` and `/kit:adopt` check, on the machine where they run, which of the skills
  that match the project's scopes are installed, and offer to install the missing ones
  (nothing is installed without your confirmation).
- The auditors and builders use a skill when it is installed (reading its checklist as
  extra checks) and add a one-line "not installed" note when it is not; nothing blocks.
- To update them, run `/kit:adopt --update`: it offers each installed skill's `update`
  command. On a new PC, the same command offers the installs.

## Updating

- **The kit:** bump `version` in `plugins/<plugin>/.claude-plugin/plugin.json`, commit and
  push; users run `/plugin marketplace update erfa-kit` (or reinstall).
- **A project:** `/kit:adopt --update` refreshes only the text between the
  `<!-- kit:block … -->` markers in `CLAUDE.md` (and the mutation recipe) and sets
  `kitVersion`; `## Project rules` and everything else stay untouched.
- Rule IDs are stable and append-only; a retired rule keeps its ID with `(retired)`.

## Repository layout

```
.claude-plugin/marketplace.json     the erfa-kit marketplace
CONVENTIONS.md                      the contract every plugin follows
plugins/kit/                        core: blocks, auditors, workflow skills, templates, seal hook
  agents/                           the seven auditors
  skills/kickoff/                   blocks/ (rules + *.structure.json), templates/, SKILL.md
  skills/{adopt,audit,phase-done}/
  scripts/                          arch-check.mjs, seal-guard.mjs, seal-write.mjs (+ __tests__)
  hooks/hooks.json                  the opt-in seal (PreToolUse)
plugins/kit-nestjs | kit-astro | kit-expo   builders and stack knowledge
```

Tests of the kit's own scripts (Node ≥ 20, no dependencies):

```bash
node --test plugins/kit/scripts/__tests__/seal-guard.test.mjs \
            plugins/kit/scripts/__tests__/arch-check.test.mjs \
            plugins/kit/scripts/__tests__/mutant.test.mjs
```
