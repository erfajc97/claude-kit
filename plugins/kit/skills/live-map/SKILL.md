---
name: live-map
description: Live-coding step 1. Starts a timed live-coding session on code you were just handed (git baseline, local-only kit files, clock) and maps it in about three minutes - stack, how to run and test, test, lint and type baselines, architecture, conventions, risks and open questions - then stops at a gate. Use for /kit:live-map at the very start.
argument-hint: "[--budget 60] [--lang es|en]"
disable-model-invocation: true
---

# /kit:live-map — understand it before touching it (3 min max)

You change NO project file. The kit writes only `.live/` and `.claude/kit.json`, both hidden
from git locally. `LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs"
<args>` with Bash (variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`).
Pass free text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any
`ok:false` or non-zero exit: show `error` and `hint`, and STOP. Talk in the user's language
(`--lang`, else the one they write in). Be short: the screen is shared and the whole session
lasts about an hour.

## 1. Start

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" init $ARGUMENTS
```

It prints JSON; keep `root`.

- Exit 3 (not a git repository): ask once; on yes run `git init`, append `node_modules/`,
  `.env`, `.env.local`, `__pycache__/` and `.venv/` to `.git/info/exclude`, then do the
  baseline commit below.
- Exit 4 (no commit): show `git status --short` (15 lines), say what a baseline commit
  sweeps in, ask once; on yes run `git add -A` and then `git commit -m baseline` as two
  separate commands, and init again.
- `resumed: true` → redo nothing: run `LIVE status` and continue from that phase.
- Show `warnings`. Empty `commands.test` → ask which command runs the tests and store it
  with `LIVE cmd test '<command>'`; if there is none, STOP: without tests there is no TDD to
  show.
- `depsInstalled: false` → ask once to run `commands.install` (a frozen install that must not
  change the lockfile), run it and wait for it.

## 2. Gather — one message, in parallel

1. Baselines in the background (Bash with `run_in_background`), one for each non-empty
   command among `test`, `lint` and `typecheck`, with absolute paths from `root`:
   `cd "<root>" && (CI=1 timeout 300 <command>) > "<root>/.live/baseline-tests.txt" 2>&1; echo "exit=$?" >> "<root>/.live/baseline-tests.txt"`
   and the same into `baseline-lint.txt` and `baseline-types.txt`. `CI=1` keeps watch-mode
   runners from waiting forever; drop `timeout 300` if that command is not found.
2. Three `Explore` agents (medium), each answering in at most 20 lines with file:line; with
   fewer than ~40 source files, read the code yourself instead:
   - **architecture** — entry points, layers, data model, the main use case traced end to
     end, conventions (naming, errors, validation, logging), config and env;
   - **tests and tooling** — framework, where tests live, fixture and mock style, CI and lint
     config, how to run the app;
   - **risks** — security surface (authentication and authorisation, input validation,
     secrets, queries, files and URLs, personal data in logs, dependencies), error-handling
     gaps, TODO/FIXME, huge or untested modules.
3. `node "${CLAUDE_PLUGIN_ROOT}/scripts/arch-check.mjs" --all | grep -oE '^\| (BLOCKER|HIGH|MEDIUM|LOW) ' | sort | uniq -c`
   — zero tokens; counts only, all of it is pre-existing.

## 3. Write `.live/map.md` (45 lines max)

Wait for the baseline runs (you are notified when each ends), 5 minutes in total at most;
stop what still runs and write "baseline unknown (timeout)". A baseline file without an
`exit=` line, or with `exit=124`, is "unknown": say so. Sections: Stack and how to run ·
Baseline (tests passing and failing with the failing names, lint and type error counts) ·
Architecture (8 bullets max) · Conventions to match · Hot spots and risks (top 5, file:line,
tagged security / data / tests) · Unknowns.

## 4. Gate

Print the map in 12 lines max. Then run `LIVE phase map` and, after it, `LIVE status`. Ask at
most 3 questions with the AskUserQuestion tool (load it with ToolSearch if it is deferred;
else ask in plain text), each about THIS repository, 2–4 options, recommended first — for
example: failing baseline tests (ignore as pre-existing / fix first), two conflicting
conventions (which one to follow), a missing run or test command. Nothing open → one sanity
check: does anything in the map disagree with what the user knows about the repo? Log each
answer with `LIVE decide '<question>' '<answer>'` (`--assumed` when the user skipped it).

Finish with `Next: /kit:live-plan <paste the statement>` and STOP.
