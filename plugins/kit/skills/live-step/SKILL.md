---
name: live-step
description: Live-coding step 3, repeated for every step. Builds ONE step of the plan test-first in the visible thread (characterization test for untested legacy, RED seen failing, GREEN, edge cases, one mutation proof, full suite against the baseline), reports in a dozen lines, offers the commit and asks the security and edge-case questions that apply to the code just written. Use for /kit:live-step, optionally with a step id such as S2.
argument-hint: "[S2] | fix <what to fix>"
disable-model-invocation: true
---

# /kit:live-step — one step, test first (8–10 min)

Rules: `.live/rules.md` (L1–L15). Work in the main thread so the screen shows the reasoning;
do not spawn builders. `LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs"
<args>` with Bash (variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`).
Pass free text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any
`ok:false` or non-zero exit: show `error` and `hint`, and STOP. Language and brevity as in
`/kit:live-map`. Arguments: $ARGUMENTS

Empty `commands.test` in `LIVE status --json` → STOP: ask for the command and store it with
`LIVE cmd test '<command>'`.

## 0. Pick the step

The step is the argument, else the first ⬜ or 🔄 row of `.live/plan.md`; none left → say so
and point to `/kit:live-audit`. `fix <text>` is a ≤ 3 min fix outside the original plan (for
example from the audit): add a row to the table first, with the next free letter after its
parent (`S2b`, then `S2c`) and the requirement it serves in Reqs. `LIVE step <ID> doing`.
Print `<ID> · <title> · est <n> min` and the `LIVE status` line.

**Clock.** Run `LIVE status` at the start of RED, of GREEN and of Verify. When it warns that
the step is at 1.5× its estimate, stop and ask: cut the rest of the step, park it, or
continue.

## 1. Brief (6 lines at most, before any code)

The behaviour in one sentence; the acceptance test names; the edge cases that apply (boundary
pair, empty or absent, duplicate, wrong type, unauthorised or foreign resource, dependency
failure or timeout, concurrency); the security question that applies (who may do this? what
input is trusted? what leaves the system?). If a choice changes the contract, the data or who
may act, ask it NOW (2 questions at most) and wait; otherwise go.

## 2. Characterize (L3)

Code you will change that has no test: write ONE test that pins what it does today on the
path you touch, run it, it must pass. Skip when already covered.

## 3. RED (L4)

Write the failing test(s). Run only them (`commands.test` with the file or name filter your
runner supports; else the suite). The failure must be an assertion about the new behaviour —
not an import error or a typo. Quote the failing line.

## 4. GREEN (L5)

The smallest change that passes; run the same tests and quote the pass line. No unrelated
edits, no new dependency without asking, and an existing test is not edited to turn it green
unless the plan says so (then say why).

## 5. Refactor

Only on green, only the step's files, behaviour unchanged. Anything bigger:
`LIVE park '<one line>'`.

## 6. Edge cases and a test that bites (L6, L10, L15)

Add the edge cases from the brief, each its own assertion with unique values, errors asserted
by code or type. Then ONE mutation proof (a minute at most; skip for pure refactors or docs):
copy the file to `.live/orig.bak` and note `git hash-object <file>`; break the most important
condition of the new code (invert a comparison, move the boundary, delete the guard) with an
edit; run the step's tests — they must FAIL; restore with `cp .live/orig.bak <file>` and
check that the hash matches. Never restore with `git checkout`, `restore` or `stash`: the
step is not committed yet and they would erase it. Still green = the test is weak:
strengthen it and repeat. If anything interrupts you, restore first.

## 7. Verify (L9, L11, L13) — one message, in parallel

`commands.test` (full), `commands.lint`, `commands.typecheck` (skip the empty ones) and
`node "${CLAUDE_PLUGIN_ROOT}/scripts/arch-check.mjs" --base <baseSha>` — never pass paths:
explicit paths turn it into a census, where a `report` scope counts nothing. Read the EXIT
codes. Compare each result with its baseline in `.live/` (`baseline-tests.txt`,
`baseline-lint.txt`, `baseline-types.txt`): only NEW failures or errors count; a baseline
without an `exit=` line or with `exit=124` is unknown — say so. Then Grep the added lines
(`git diff <baseSha> -U0` plus every untracked file from `LIVE changed --json`) for debug
prints (`console.log`, `print(`, `debugger`, `System.out.println`, `fmt.Println`,
`var_dump`) and TODO/FIXME.

## 8. Report (12 lines at most)

`<ID> ✅ <title>` · files and `git diff --stat <baseSha>` last line · tests added (names) ·
RED→GREEN lines · `mutant → killed by <test>` · suite counts against the baseline · one
decision or trade-off · `RED✔ GREEN✔ bordes✔ seguridad✔ mutación✔ suite✔ diff limpio✔`
(✖ and the reason where not met) · the clock. Append the report to `.live/steps.md` with a
Bash heredoc (`cat >> .live/steps.md <<'EOF'`), then print it. Draft the commit:
`[ADD|FIX|REFACTOR|TEST] <ID> <what>`, a line with WHY, `Verified: <commands and counts>`.

## 9. Gate

Ask (2 questions at most, about THIS code — for example "limit has no cap: cap it at 100?")
plus the commit question: commit now (recommended) / later. AskUserQuestion, recommended
first. Commit only on yes: write the message to `.git/KIT_COMMIT_MSG`, stage exactly this
step's files with `git add -- <paths>` (`git status --short` lists them) and commit with
`git commit -F .git/KIT_COMMIT_MSG`, as two separate commands. Never push, reset, checkout,
restore, stash, clean or rebase (L15). Then `LIVE step <ID> done --commit <short sha>`
(without `--commit` when not committed). An answer that implies work becomes the first test of
the next step, a fix row (≤ 3 min) or `LIVE park '<one line>'`. Log every answer with
`LIVE decide '<question>' '<answer>'`.

Finish with `Next: /kit:live-step` (name the next ID) or `/kit:live-audit` when none is left,
and STOP.
