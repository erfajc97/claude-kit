---
name: live-plan
description: Live-coding step 2. Turns the interviewer's ask into testable requirements, assumptions, a short pre-mortem with the security questions that apply, and three to five small test-first steps sized to the time left, then stops at a gate with the open questions. `--amend` folds in a change of scope. Use for /kit:live-plan followed by the pasted statement.
argument-hint: "<statement> | --amend <change>"
disable-model-invocation: true
---

# /kit:live-plan — from the ask to small steps (5 min max)

`LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" <args>` with Bash
(variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`). Pass free
text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any `ok:false` or
non-zero exit: show `error` and `hint`, and STOP. Language and brevity as in `/kit:live-map`.
The statement is: $ARGUMENTS

Empty → ask the user to paste it and STOP.

## 1. Read

`LIVE status --json` (clock, commands), `.live/map.md`, `.live/decisions.md`. Save the
statement verbatim in `.live/statement.md` (`--amend`: append it under a new heading and work
on the change only).

## 2. Requirements

`R1…Rn`, each testable — inputs, outputs, limits, status codes, numbers — and tagged MUST /
SHOULD / COULD from the statement's own words. Write `.live/checklist.md` with the columns
`| ID | Requirement | Prio | Status | Evidence |` and every status ⏳.

## 3. Assumptions and pre-mortem

For each ambiguity choose a default and tag it `(assumption)`. Then six bullets at most, only
those that apply: if this fails in the demo or in production, how? Who may do this
(authentication, ownership), input validation, data that leaves the system, secrets or
personal data in logs, abuse and rate, injection, concurrency and idempotency, a dependency
that is down.

## 4. Steps

3–5 vertical slices. First: the smallest slice that proves the main flow. Risky or unknown
parts early; refactors and cleanup last, only if time remains. Minutes for steps = minutes
left − 12 (audit, wrap, buffer); each step ≤ 10 min. Cut the steps that only serve COULD
requirements, then SHOULD ones, to fit, and list them under "Out of scope (time)". Write
`.live/plan.md`: a title, the assumptions, the pre-mortem, the out-of-scope list and this
table exactly — no `|` inside a cell, Est in whole minutes, Reqs the requirement IDs the step
serves:

```
| ID | Step | First test(s) | Est | Reqs | Status |
|---|---|---|---|---|---|
| S1 | … | `name of the first failing test` | 8 | R1 | ⬜ |
```

Then run `LIVE status --json` and check that `steps.total` equals the rows you wrote and
`steps.pendingEst` equals the sum of their Est; if not, fix the table and check again.

## 5. Questions for the interviewer

At most 4 things only the interviewer can answer (product intent, limits, priorities). Print
them as a list the user can ask aloud — not through AskUserQuestion.

## 6. `--amend`

Add or change the R and S rows (the next free letter for a step in the middle), show the time
delta, and if the open steps no longer fit, ask which one to park (`LIVE step <ID> parked`).

## 7. Gate

Print the table (10 lines max). Then run `LIVE phase plan` and, after it, `LIVE status`. Ask
at most 3 questions on the most consequential ambiguities with AskUserQuestion (load it with
ToolSearch if it is deferred; else plain text), recommended option first, each about THIS
statement. Fold the answers into the plan and the checklist and log each with
`LIVE decide '<question>' '<answer>'` (`--assumed` when skipped).

Finish with `Next: /kit:live-step` and STOP.
