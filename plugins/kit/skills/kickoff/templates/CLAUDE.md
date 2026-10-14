<!-- kit:block header v1 -->
# {{project}} — engineering rules

> Composed by claude-kit {{kit_version}} from `.claude/kit.json`. Text between
> `<!-- kit:block … -->` markers belongs to the kit: `/kit:adopt --update` refreshes it and
> never touches anything else. The project's own rules live in `## Project rules` (IDs
> `P1, P2…`), which the kit never rewrites. Every agent reads `.claude/kit.json` first.

**Rigor: `{{rigor}}`.** {{rigor_statement}}

| Scope | Kind | Stack | Path | Mode |
|---|---|---|---|---|
{{scopes_table}}

Modes: `enforce` — the rules apply and auditors block on findings; `report` — inherited
code: findings on code that already existed are listed as pre-existing and never block, new
code follows the rules; `off` — the kit ignores the scope.

- Requirements: `{{requirements.source}}` (IDs look like `{{requirements.idScheme}}`) ·
  checklist `{{requirements.checklist}}`.
- Tracking: {{tracking_docs}}.
- Commits: {{commit_format}}.
- Addons: {{addons_list}}. Brand: {{brand_line}}.
- Mutation recipe: `.claude/kit/mutant/RECIPE.md`. Lessons learned: `docs/quality-standard.md`.
- Daily loop: task → `/kit:audit` (at the rigor above) → fixes → `/kit:phase-done` → the
  main agent commits.
<!-- /kit:block header -->

{{blocks}}

## Project rules

<!-- Rules specific to this project, IDs P1, P2… (stable, append-only). Same format as the
kit rules: the rule, then Why, then Check. The kit never writes or rewrites this section. -->

<!-- kit:block commands v1 -->
## Commands

{{commands_section}}
<!-- /kit:block commands -->
