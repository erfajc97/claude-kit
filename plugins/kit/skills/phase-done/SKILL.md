---
name: phase-done
description: Close a task or phase - re-runs only the audits that failed (or the project's rigor chain if none ran), ticks the progress log and the checklist with evidence, drafts the commit message in the project's commitStyle with a Verified line, and reminds that the main agent commits (staging and commit as two commands). Use for /kit:phase-done after the builder's fixes, or when a task is finished.
argument-hint: "[task id] [quick|full]"
---

# /kit:phase-done

You close one task. You never commit by yourself unless the user already asked for the
commit in this conversation; builders and auditors never commit at all (G7).

**Paths.** The kit plugin root is `../../` from THIS skill's folder (`scripts/`); the audit
skill is `../audit/SKILL.md` — follow it when this skill says "run the audit".

## 1. Gather

1. `.claude/kit.json`: `rigor`, `tracking`, `commitStyle`, `requirements.checklist`,
   `seal`, scopes.
2. `.claude/kit-audit-state.json` (the last `/kit:audit`), if present.
3. The task ID: the argument, or the one in the state / builder report; if unknown, ask.
4. The paths of the task:

   ```bash
   git diff HEAD --name-status
   git ls-files --others --exclude-standard
   ```

   compared with `paths` of the state. Files of other sessions are not part of the task:
   ask when unsure.

## 2. Audit until it passes

- No state, or the state's paths differ from the task's → run the audit for the project's
  rigor (`../audit/SKILL.md`, default mode; `quick`/`full` if the user passed one).
- State with failures → run ONLY the failed auditors (`--only <names>`) on the task's
  paths; add `rules` if files outside the state's paths changed since.
- Still FAIL after one round of fixes → stop and show what remains; do not loop on your own
  (the builder fixes, then the user runs `/kit:phase-done` again).
- `rigor: lite` → the quick audit only; mutation is skipped (say so in the message).

Only continue with a PASS.

## 3. Tick the tracking docs (G8)

| `tracking` | Update |
|---|---|
| `plan` | README "Progress (TODO)": the task's line `⬜`/`🔄` → `✅`; `docs/plan.md` § Status: done / next / blocked |
| `backlog` | `docs/backlog.md`: the task's **Status** → `✅` (and the summary table); `docs/progress.md`: a new entry ON TOP with Done (IDs), Next, Blocked, Decisions (`(proposal)` items), For the owner, Verification |
| both | the checklist (`kit.json` → `requirements.checklist`): the rows of the requirements this task closes → `✅` with the evidence from `auditor-challenge` (file:line, test name, command output); without a challenge report, leave `⏳` and say so |

Edit surgically (G14): change the lines of this task only. When the project keeps its
tracking docs under other names, the `CLAUDE.md` header names them.

With `"seal": true`, add the tracking files you just edited to the seal (they hold no code;
the audit already passed):

```bash
node "<kit>/scripts/seal-write.mjs" --add -- <README.md | docs/…> ; echo "exit=$?"
```

## 4. Draft the commit message

Write it to `.git/KIT_COMMIT_MSG` (inside `.git`: never staged) and show it.

- **Subject** (≤ 72 chars), per `commitStyle`:
  - `tags` → `[ADD] T-ORD-03 orders can be cancelled while pending` — tag from the change:
    `[ADD]` feature, `[FIX]` bug, `[REFACTOR]`, `[TEST]`, `[DOCS]`, `[STYLE]`, `[CHORE]`,
    `[PERF]`.
  - `conventional` → `feat(T-ORD-03): orders can be cancelled while pending`.
- **Body**:
  - WHY: the problem or requirement, in two or three lines (not a file list).
  - `Verified:` one line with the commands run and their counts, e.g.
    `Verified: api lint ✔ typecheck ✔ test 214/214 ✔ integration 38/38 ✔; web test 96/96 ✔ build ✔; audit rules+tests PASS`.
  - `Mutation: <k>/<n> killed` (from `auditor-tests` or the builder report);
    `rigor lite` → `Mutation: skipped (rigor lite)`.
  - `Deploy order:` when the audit notes mention a contract change (API before clients;
    OTA or native build for mobile).
  - Owner notes that must travel with the commit (env to load by hand, migrations).
  - The attribution trailer the session requires, if any.

## 5. Hand over the commit

Remind, and only run it when the user asks (or already asked) for the commit:

```bash
git add -- <the task's paths> <tracking files>
git commit -F .git/KIT_COMMIT_MSG
```

- Two separate commands: with the seal on, the hook refuses `git add … && git commit` and
  `git commit -a`.
- Never `--no-verify`, never `HUSKY=0`. A hook failure is fixed, not skipped.
- Builders and auditors never run these; only the main agent does (G7).

After the commit: `git log -1 --stat` to confirm, then name the next task from the plan or
backlog.
