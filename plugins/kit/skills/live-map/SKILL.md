---
name: live-map
description: Live-coding step 1. Starts a timed live-coding session on code you were just handed (git baseline, local-only kit files, clock) and maps it in about two minutes - stack, how to run and test, test baseline, architecture, conventions, risks and open questions - then stops at a gate. Use for /kit:live-map at the very start.
argument-hint: "[--budget 60] [--lang es|en]"
disable-model-invocation: true
---

# /kit:live-map — understand it before touching it (3 min max)

You change NO project file. The kit writes only `.live/` and `.claude/kit.json`, both hidden
from git locally. `LIVE` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs"` (if that
variable was not substituted, use `<this skill's base directory>/../../scripts/live.mjs`).
Talk in the user's language (`--lang`, else the one they write in). Be short: the screen is
shared and the whole session lasts about an hour.

## 1. Start

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" init $ARGUMENTS
```

It prints JSON. Exit 3 (not a git repository) or 4 (no commit): ask once, and on yes run
`git init` / `git add -A && git commit -m baseline`, then init again. `resumed: true` → redo
nothing: run `LIVE status` and continue from that phase. Show `warnings`. No `commands.test`
→ ask which command runs the tests.

## 2. Gather — one message, in parallel

1. Baseline tests in the background (Bash with `run_in_background`):
   `(<commands.test>) > .live/baseline-tests.txt 2>&1; echo "exit=$?" >> .live/baseline-tests.txt`
2. Three `Explore` agents (medium), each answering in at most 20 lines with file:line; with
   fewer than ~40 source files, read the code yourself instead:
   - **architecture** — entry points, layers, data model, the main use case traced end to
     end, conventions (naming, errors, validation, logging), config and env;
   - **tests and tooling** — framework, where tests live, fixture and mock style, CI and lint
     config, how to run the app;
   - **risks** — security surface (authentication and authorisation, input validation,
     secrets, queries, files and URLs, personal data in logs, dependencies), error-handling
     gaps, TODO/FIXME, huge or untested modules.
3. `node "${CLAUDE_PLUGIN_ROOT}/scripts/arch-check.mjs" --all` — zero tokens; keep only the
   counts per severity (all of it is pre-existing).

## 3. Write `.live/map.md` (45 lines max)

The baseline test run finishes on its own and you are notified: wait for it before filling the
Baseline line (if everything else is ready and it still runs, say so and fill it in when it
ends). Stack and how to run · Baseline (tests passing/failing; the failing names are pre-existing) ·
Architecture (8 bullets max) · Conventions to match · Hot spots and risks (top 5, file:line,
tagged security / data / tests) · Unknowns.

## 4. Gate

Print the map in 12 lines max, then `LIVE status`. Ask at most 3 questions with the
AskUserQuestion tool (load it with ToolSearch if it is deferred; else ask in plain text),
each about THIS repository, 2–4 options, recommended first — for example: failing baseline
tests (ignore as pre-existing / fix first), two conflicting conventions (which one to
follow), a missing run or test command. Nothing open → one sanity check: does anything in the
map disagree with what the user knows about the repo? Log each answer with
`LIVE decide "<question>" "<answer>"` (`--assumed` when the user skipped it). Then
`LIVE phase map`.

Finish with `Next: /kit:live-plan <paste the statement>` and STOP.
