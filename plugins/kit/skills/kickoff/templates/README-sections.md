## How this was built

This project was built with AI coding agents under explicit, non-negotiable rules written
before any code (`CLAUDE.md`: TDD with a mutation check, layered feature structure, strict
DTOs, one error catalog, design tokens only, i18n for every string, and more), composed by
[claude-kit](https://github.com/erfajc97/claude-kit), and a fixed workflow per phase:

1. The plan and the contract first (`docs/plan.md`); every requirement of
   `{{requirements.source}}` is a row in `{{requirements.checklist}}`.
2. A builder agent implements the phase test-first and proves its tests with mutants.
3. Independent, read-only audit agents review it before the commit, at rigor
   `{{rigor}}`: {{auditors_list}}. Nothing is committed with an open BLOCKER or HIGH.
4. Commit messages say why and what was verified (`git log`).

<!-- Add one or two decisions that came out of the audits. -->

## Progress (TODO)

Legend: ✅ done · 🔄 in progress · ⬜ pending. Every ✅ passed the audit of the project's
rigor before its commit.

### Setup & planning

- ✅ Requirements analysed: plan (`docs/plan.md`) and compliance matrix (`{{requirements.checklist}}`)
- ✅ Non-negotiable rules (`CLAUDE.md`) and the kit configuration (`.claude/kit.json`)
- ⬜ F0 · Scaffold: layout, tooling, CI, `.env.example`

### <Scope or area>

- ⬜ F1 · <phase title>

### Delivery

- ⬜ <final phase: E2E, full audit, README complete>
