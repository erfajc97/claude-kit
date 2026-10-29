---
name: live-wrap
description: Live-coding step 5. Closes the session with a requirement-to-evidence table, what was built and tested, decisions and trade-offs, accepted and parked risks, what you would do with more time and how to run it, as a spoken summary and a handoff file. Use for /kit:live-wrap in the last minutes.
argument-hint: "[--lang en]"
disable-model-invocation: true
---

# /kit:live-wrap — tell the story (2 min)

`LIVE <args>` means running `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" <args>` with Bash
(variable not substituted → `<this skill's base directory>/../../scripts/live.mjs`). Pass free
text to `LIVE` in single quotes, without apostrophes, backticks or `$`. Any `ok:false` or
non-zero exit: show `error` and `hint`, and STOP. Language and brevity as in `/kit:live-map`
(`--lang` overrides). Arguments: $ARGUMENTS

1. Read: `LIVE status --json`, `LIVE changed --stat`, `.live/plan.md`, `.live/checklist.md`,
   `.live/steps.md`, `.live/decisions.md`, `.live/parked.md` and `.live/audit.md` when
   present.
2. Update `.live/checklist.md`: the final status of every requirement (✅ / ⚠️ / ❌) with its
   evidence (file:line and test name). Never ✅ without evidence.
3. Write `.live/handoff.md` (40 lines at most): Asked · Done (steps ✅ / ⏸) · Requirement →
   evidence table · Tests (added, total against the baseline) · Decisions and trade-offs (5
   at most) · Risks accepted or parked · What I would do with more time (5 at most, ranked)
   · How to run and test.
4. Print the spoken summary: 10 lines at most, in the session language, first person, what
   was asked, what was built, how it was proven, what was decided and what is left.
5. Run `LIVE phase wrap`. Gate: 2 questions at most with AskUserQuestion — anything left
   unsaid or to fix? leave `NOTES.md` with the handoff in the repository (default no)?
   Uncommitted leftovers are only suggested for commit, never committed silently. Log answers
   with `LIVE decide '<question>' '<answer>'`.
6. Print the final `LIVE status` and STOP.
