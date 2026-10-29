---
name: live-ask
description: Live-coding, any time. Sweeps the current diff and plan for what the author may have missed (scope, data, failure modes, security, performance, UX, tests) and asks the human the highest-impact questions, three at most, parking the rest. Use for /kit:live-ask when unsure, before a commit or when stuck.
argument-hint: "[focus: security|data|tests|edge]"
disable-model-invocation: true
---

# /kit:live-ask — what am I missing? (1 min)

`LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" <args>` with Bash
(variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`). Pass free
text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any `ok:false` or
non-zero exit: show `error` and `hint`, and STOP. Language and brevity as in `/kit:live-map`.
Focus: $ARGUMENTS

1. Context: `LIVE changed --json` (take `baseSha`, `files` and `untracked` from it). Read the
   added lines of `git diff <baseSha>` and, in full, every untracked file (they are entirely
   new), plus `.live/plan.md`, `.live/decisions.md` (never re-ask what is decided) and
   `.live/parked.md`.
2. Walk the lenses in `.live/rules.md` (Question lenses), the focus first.
3. Keep the 5 findings with the highest impact on THIS diff. Each one: the lens, a concrete
   scenario in one line (input → wrong outcome), file:line, the proposed fix.
4. Ask the top 3 with AskUserQuestion: fix now (recommended) / accept the risk / park it. Log
   each with `LIVE decide '<finding>' '<answer>'`; the rest go to `LIVE park '<one line>'`.
   A fix becomes `/kit:live-step fix <what>`.
5. Print the `LIVE status` line and STOP.
