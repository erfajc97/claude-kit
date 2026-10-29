---
name: live-audit
description: Live-coding step 4. Audits everything changed since the baseline with a fast zero-token pass (tests, lint, typecheck, arch-check) and, unless --quick, the tests, challenge (requirement to evidence) and security auditors in parallel with a three-minute time box, then stops at a gate asking what to do with each BLOCKER or HIGH. Use for /kit:live-audit once the steps are done.
argument-hint: "[--quick] [--only tests,security] [--with rules,ux]"
disable-model-invocation: true
---

# /kit:live-audit — prove it (4 min)

`LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" <args>` with Bash
(variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`). Pass free
text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any `ok:false` or
non-zero exit: show `error` and `hint`, and STOP. You never fix code here. Language and
brevity as in `/kit:live-map`. Arguments: $ARGUMENTS

## 1. What changed

`LIVE changed --json` → `baseSha`, `files`, `untracked`. None → "nothing to audit" and STOP.
Empty `commands.test` in `LIVE status --json` → STOP (ask for it, `LIVE cmd test '<command>'`).

## 2. Fast pass — one message, in parallel

`commands.test` (full), `commands.lint`, `commands.typecheck` (skip empty ones) and
`node "${CLAUDE_PLUGIN_ROOT}/scripts/arch-check.mjs" --base <baseSha>` — never pass paths:
explicit paths turn it into a census, where a `report` scope counts nothing. Read the EXIT
codes. Compare each with its baseline in `.live/` (`baseline-tests.txt`, `baseline-lint.txt`,
`baseline-types.txt`): failures listed there are pre-existing; no `exit=` line or `exit=124`
means unknown. `--quick` → print the table and STOP.

## 3. Choose the auditors

`tests` and `challenge` always. `security` when a changed file handles input, auth, sessions,
data access, files, network calls, env or payments (route, controller, handler, auth, token,
query, sql, upload, fetch, env, password). `ux` only with `--with ux` or when UI files changed
(`.tsx .jsx .vue .svelte .html .css`). `rules` only with `--with rules`. `--only` overrides
everything.

## 4. Launch in parallel

Say in one line what runs and that it takes about 3 minutes, then launch every auditor in ONE
message with the Agent tool, `subagent_type: "kit:auditor-<name>"`, prompt:

```
Live profile (.claude/kit.json has "profile": "live"). Audit this change. Time box: about 3
minutes; read only the paths and their tests.
Paths (audit ONLY these): <files>
Base: <baseSha> — `git diff <baseSha> -U0 -- <file>` gives the added lines; a file that is
untracked or absent at <baseSha> is entirely new; everything older is Pre-existing.
Rules: .live/rules.md. Requirements: .live/statement.md and .live/checklist.md. Plan: .live/plan.md.
What the author proved, step by step: .live/steps.md.
Decisions already taken (do not re-raise an accepted risk): .live/decisions.md
Fast-pass results (do NOT rerun the suite, lint or typecheck unless a failure needs a rerun):
<command → exit code and counts, for each>. Baselines: .live/baseline-tests.txt,
.live/baseline-lint.txt, .live/baseline-types.txt.
Return ONLY your report in the kit format (### Passed, ### Findings, ### Pre-existing (not
counted), ### Notes for the owner, VERDICT).
```

Wait 5 minutes at most: at that point print what arrived and mark the rest TIMEOUT.

## 5. Merge

When the reports arrive: one table `auditor · verdict` (arch-check included), findings sorted
BLOCKER → LOW with file:line and fix, duplicates merged, pre-existing counted but not
listed. Write it to `.live/audit.md` (the full text) and print at most 15 lines plus the
BLOCKER and HIGH rows.

## 6. Gate

Run `LIVE phase audit` first. For each BLOCKER or HIGH (group the rest) ask, 3 questions at
most with AskUserQuestion: fix now (recommended) / accept the risk / park it. Log each with
`LIVE decide '<finding>' '<answer>'`. Fixes become rows with the next free letter (`S2b`,
`S2c`, ≤ 3 min each) run with `/kit:live-step fix …`; after them run
`/kit:live-audit --quick` and then the wrap-up. Parked ones go to `LIVE park '<one line>'`.
Then print `LIVE status`.

Finish with `Next: /kit:live-step fix …` or `/kit:live-wrap` and STOP.
