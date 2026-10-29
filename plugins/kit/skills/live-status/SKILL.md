---
name: live-status
description: Live-coding, any time. One line with the clock, the phase, the plan progress, the time spent in the current step, whether the remaining steps still fit and the next command. Use for /kit:live-status.
disable-model-invocation: true
---

# /kit:live-status

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" status` with Bash (variable not substituted
→ `<this skill's base directory>/../../scripts/live.mjs`) and print its output as it is. Any
`ok:false` or non-zero exit: show `error` and `hint`, and STOP.

If it warns that the plan does not fit, or that the current step is at 1.5× its estimate,
propose what to park or cut (the open step that serves the lowest-priority requirement) and
ask one question; on yes run `step <ID> parked` with the same script. Nothing else: no
analysis, no files.
