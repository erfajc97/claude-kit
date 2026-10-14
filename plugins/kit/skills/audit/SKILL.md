---
name: audit
description: Run the kit's audit on the current change and print ONE merged report with one VERDICT. `/kit:audit quick` = architecture, secrets and dead code only, zero LLM tokens (arch-check.mjs); `/kit:audit` = the chain of the project's rigor (lite → quick, standard → rules + tests, full → the whole audit.chain); `/kit:audit full` = the whole chain regardless of rigor. On PASS with seal on, writes .claude/kit-seal.json. The main agent runs it automatically after every finished task and before every commit (G6).
argument-hint: "[quick|full] [--all] [--milestone] [--only rules,tests] [--explain] [paths...]"
---

# /kit:audit

You orchestrate read-only auditors and merge their reports. You never fix code here, never
commit, and never edit a project file except the kit's own state files
(`.claude/kit-audit-state.json`, `.claude/kit-seal.json`).

**Paths.** The kit plugin root is `../../` from THIS skill's folder:
`<kit>/scripts/arch-check.mjs` and `<kit>/scripts/seal-write.mjs` (use absolute paths in
commands).

## 1. Parse the request

| Argument | Meaning |
|---|---|
| (none) | the chain of the project's rigor |
| `quick` | architecture only: `arch-check.mjs`, no agent (add `--explain` to have `kit:auditor-rules` explain the findings) |
| `full` | the whole `audit.chain`, whatever the rigor |
| `--milestone` | add `audit.milestone` (`judgment`, `senior`) |
| `--only a,b` | run only these auditors (used by `/kit:phase-done` to re-run what failed) |
| `--all` | the whole repository instead of the change (census) |
| `paths…` | audit exactly these paths |

## 2. Read the configuration

Read `.claude/kit.json`: `rigor` (default `standard`), scopes (`name → kind, stack, path,
mode`), `audit.chain`, `audit.milestone`, `seal`. Missing → tell the user to run
`/kit:adopt`; `quick` still works (general checks only); otherwise use the chain
`rules, tests`.

## 3. Resolve the paths and scopes

Paths from the arguments, or the change:

```bash
git diff HEAD --name-status
git ls-files --others --exclude-standard
```

- Map each path to the scope with the longest matching `path`; drop paths of `off`
  scopes; keep the rest (files outside every scope are "shared").
- Keep deleted files in the list for the seal; auditors skip them.
- Nothing left → print "Nothing to audit (no changes in enforced or reported scopes)" and
  stop. Do not write a seal.
- When several sessions share the tree, audit only the paths of THIS task: if `git status`
  shows files you did not touch, ask the user which belong to the task (or use the paths
  the builder report lists).

## 4. Choose the auditors

1. **Always first: the architecture pass** (zero tokens):

   ```bash
   node "<kit>/scripts/arch-check.mjs" [--all] -- <paths>; echo "exit=$?"
   ```

   Exit 0 PASS, 1 FAIL, 2 could not run (show the error, continue with the agents).
2. **Mode → chain**:
   - `quick`, or no mode with `rigor: lite` → the architecture pass is the whole audit.
   - no mode with `rigor: standard` → `rules`, `tests`.
   - no mode with `rigor: full`, or `full` → every auditor of `audit.chain`.
   - `--milestone` → add `audit.milestone`. `--only` → exactly that list.
3. **Drop what has nothing to look at** (say so in the merged report):
   - `ux` when no UI file changed (no `.tsx .jsx .astro .vue .css` or locale file in a
     `web`/`mobile` scope);
   - `security` when the change is only docs, tests or styles;
   - `challenge` when no task or requirement ID is known for the change and `--all` was not
     given (ask the user for the task ID instead of guessing);
   - docs-only change → only `rules`.

## 4b. External skills for each auditor

The kit bundles no third-party skills; `../kickoff/external-skills.json` lists the ones
that sharpen an audit (`{ skills: [{ name, purpose, useWhen: { kind, stack }, source,
install, update, checkPath, license, usedBy }] }`). For each auditor you will launch:

1. Take the entries whose `usedBy` names that auditor (`auditor-ux`, or `kit:auditor-ux`)
   and whose `useWhen` matches a touched scope (`kind`/`stack` may be a string, a list or
   `*`; a missing field matches anything).
2. Expand `checkPath` (`~` = the home folder) and test it (`ls -d <path>`).
3. Pass the result in that auditor's prompt (step 5): installed → the path of the skill's
   `SKILL.md`; missing → its `install` command.

No file (older kit) → pass "none" and go on. A missing skill never stops the audit; it is
one owner note.

## 5. Tell the user the cost, then run

Before launching agents, print one line, e.g.:
"Running 3 auditors in parallel (rules, tests, security). Each reads the change on its own,
so this costs about 3× the tokens of one audit. Say 'sequential' next time to run them one
by one."

Launch every chosen auditor in ONE message (parallel) with the Agent tool,
`subagent_type: "kit:auditor-<name>"` — sequentially only if the user asked. Prompt for each:

```
Audit this change. Mode: <default|full|milestone>. Rigor: <rigor>.
Paths (audit ONLY these): <list>
Scopes touched: <name (kind, stack, path, mode)> …
Task / requirement IDs: <ids or "unknown">
Base: HEAD (working tree + index + untracked) | <range for milestones>
Architecture pass (arch-check) report:            ← for auditor-rules only
<the full arch-check output>
External skills for you: <name: installed at <path>/SKILL.md | missing, install: <command>> … | none
Kit scripts folder: <kit>/scripts
Return ONLY your report in the kit format (## title, ### Passed, ### Findings,
### Pre-existing (not counted), ### Notes for the owner, VERDICT line).
```

## 6. Merge into one report

From each report take the `VERDICT` line, the Findings rows, the Pre-existing rows and the
notes. `auditor-senior` is advisory: its points go to a separate "Advisory" section and
never change the verdict.

```markdown
## /kit:audit — <mode> · rigor <rigor> · <n> files · <scopes>
| Auditor | Verdict |
|---|---|
| arch-check | PASS |
| rules | FAIL (0 BLOCKER, 2 HIGH) |
| tests | PASS |
### Findings
| Auditor | Sev | Rule | File:line | Finding | Fix |
|---|---|---|---|---|---|
### Pre-existing (not counted)
| Auditor | Sev | Rule | File:line | Finding |
|---|---|---|---|---|
### Notes for the owner
- <deduplicated notes: deploy order, env to load by hand, OTA vs native build, manual checks>
### Advisory (auditor-senior)
<if it ran>
VERDICT: PASS | FAIL (<total> BLOCKER, <total> HIGH)
```

- Sort findings BLOCKER → HIGH → MEDIUM → LOW; merge duplicates (same file:line and rule)
  keeping every auditor name.
- Overall `FAIL` iff any auditor (arch-check included) counted a BLOCKER or HIGH.
- Skipped auditors are listed with the reason ("ux: no UI files").

## 7. Record the state

Write `.claude/kit-audit-state.json` (git-ignored) so `/kit:phase-done` can re-run only
what failed:

```json
{ "at": "<ISO time>", "mode": "default", "rigor": "standard", "paths": ["…"],
  "results": { "arch-check": "PASS", "rules": "FAIL (0 BLOCKER, 2 HIGH)", "tests": "PASS" },
  "verdict": "FAIL" }
```

## 8. Seal (only with `"seal": true`)

On an overall PASS, seal exactly the audited files (files, not folders; deleted files
included):

```bash
node "<kit>/scripts/seal-write.mjs" -- <path> <path> …; echo "exit=$?"
```

On FAIL, write nothing: the commit hook keeps blocking until a PASS. Remind the user that
any edit after the seal invalidates it for that file.

## 9. What next

- FAIL → hand the findings to the builder of that scope; after the fixes run
  `/kit:phase-done` (it re-runs only the failed auditors) or `/kit:audit --only <failed>`.
- PASS → `/kit:phase-done` to tick the progress log and draft the commit message.
- `quick` found BLOCKERs in secrets → tell the user to rotate the key now, before anything
  else.
