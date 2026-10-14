# Backlog — {{project}}

Work plan for `{{requirements.source}}`. Every requirement in scope is covered by at least
one task; the traceability table at the end proves it. If this file and the source differ,
**the source wins** and this file is corrected.

> Read before taking a task: `CLAUDE.md` → this task → `docs/progress.md` → the ADR that
> applies (`docs/adr/`). A scope change is written here first (G1); if it changes the data
> model, cost or security, ask the owner first (G11).

## How to read a task

```
#### T-<MODULE>-NN · Title
- Requirements · Depends on · Agent · Estimate · Priority · Status
- Acceptance criteria (each one becomes an automated test, G2)
```

- **Agent**: the builder that owns it (`kit-nestjs:api-builder`, `kit-astro:web-builder`,
  `kit-expo:mobile-builder`, `kit-astro:qa-e2e`, or `main` for setup and docs).
- **Estimate**: agent-days (½ to 2 per task; split anything bigger).
- **Priority**: P1 (protect first) … P5 (cut first if time runs out).
- **Status**: ⬜ pending · 🔄 in progress · ✅ done (definition of done in `CLAUDE.md`) ·
  ⛔ blocked (the reason is in `docs/progress.md`).
- **Criteria conventions**: errors are named by their catalog code; "other tenant" = the
  same request on another tenant's resource answers 404; "limit" = the last value that
  passes and the first that fails (FT1). Anything not from the source or an ADR is marked
  _(proposal)_.

## Summary

<!-- SUMMARY -->

| Block | Tasks | Agent-days | Requirements closed |
|---|---|---|---|
| Phase 0 | | | |
| **Total** | | | |

<!-- /SUMMARY -->

---

## Phase 0 · Setup

| Task | Title | Requirements | Agent | Est. | Prio. | Status |
|---|---|---|---|---|---|---|
| T-F0-01 | Repository, tooling and CI | — | main | 1 d | P1 | ⬜ |

#### T-F0-01 · Repository, tooling and CI

- **Requirements:** — · **Depends on:** — · **Agent:** main · **Estimate:** 1 d ·
  **Priority:** P1 · **Status:** ⬜
- **Acceptance criteria:**
  - Lint, typecheck, tests and build run in CI on every PR and are green.
  - `.claude/kit.json` and `CLAUDE.md` exist; `/kit:audit quick` passes.

---

## Traceability: requirement → tasks

| Requirement | Tasks |
|---|---|
