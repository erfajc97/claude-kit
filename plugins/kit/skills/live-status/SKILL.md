---
name: live-status
description: Live-coding, any time. One line with the clock, the phase, the plan progress, whether the remaining steps still fit and the next command. Use for /kit:live-status.
disable-model-invocation: true
---

# /kit:live-status

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/live.mjs" status` (not substituted → `<this skill's
base directory>/../../scripts/live.mjs`) and print its output as it is.

If it warns that the plan does not fit, propose which open step to park (the lowest priority)
and ask one question; on yes run `LIVE step <ID> parked`. Nothing else: no analysis, no files.
