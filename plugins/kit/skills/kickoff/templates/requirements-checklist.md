# Requirements checklist — {{project}}

Every row is a literal requirement extracted from `{{requirements.source}}`. If this file
and the source disagree, **the source wins** and this file is corrected.

`auditor-challenge` marks each row with **hard evidence**: `file:line`, the name of the
test that asserts it, or a command and its output (with the stack running, `curl` against
the real endpoints). **Nothing is ✅ from memory.** The main agent copies that evidence here
when a task closes (G8).

**Legend:** **[MUST]** explicit requirement · **[SHOULD]** "desirable" / valued ·
**[OPT]** optional extra.
**Status:** ✅ verified · ⚠️ met with a caveat (what is missing) · ❌ missing · ⏳ not yet
audited.

**Literal reading:** status codes, field and parameter names, units and numbers, "by
organization", "with confirmation", "configurable from …" (the screen must exist, not only
the table), "in the background with a notice", "from 360 px". Performance figures are
**measured** (p50/p95 of ≥ 20 runs) or marked ⚠️ "not measured".

**Last audit:** <date> · HEAD `<sha>` · <x>/<y> MUST ✅ · SHOULD <a>/<b> · ⚠️ <k> · ❌ <z>.

## A. <section of the source>

| ID | Requirement (literal, shortened) | Status | Evidence |
|---|---|---|---|
| <ID> | [MUST] <text> | ⏳ | |

## B. Non-functional

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| <ID> | [MUST] <performance / security / accessibility / delivery requirement> | ⏳ | |

## C. Delivery

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| <ID> | [MUST] <README sections, one-command boot, repository access…> | ⏳ | |

## Interpretations

<!-- Ambiguous requirements: how the implementation reads them and where that is
documented (progress log / README decisions / ADR). -->

| ID | Reading taken | Documented in |
|---|---|---|
