# {{project}} — execution plan

> Source of truth for scope: `{{requirements.source}}`.
> Compliance matrix (what `auditor-challenge` checks): `{{requirements.checklist}}`.
> How code is written (non-negotiable rules): `CLAUDE.md`.
> Progress lives in the "Progress (TODO)" list of `README.md`, ticked at the end of every
> phase (G8).

## 1. Goal

<!-- Two to five lines: what ships, for whom, by when, and what "done" means for the whole
project. -->

## 2. Repository layout

```
<repo>/
├── <scope path>/        # <kind> · <stack> — one line on what it is
└── docs/                # plan, checklist, ADRs, quality standard
```

## 3. Contract

<!-- Contract-first: when API and clients are built in parallel, fix the contract here
before any phase starts. -->

### Errors — one envelope for every non-2xx

`{ "code": "<catalog code>", "message": "…", "details": {}, "requestId": "…" }`

### Endpoints

| Method | Path | Auth | Request | Response | Status codes |
|---|---|---|---|---|---|

### Validation decisions

<!-- Our judgment where the requirements are silent; each row is tested. -->

| Field / rule | Decision | Layer (DTO / service / DB) | Why |
|---|---|---|---|

## 4. Key decisions

<!-- Numbered; each one says what was chosen, the alternative, and why. Big ones also get
an ADR in docs/adr/. The README "Decisions" section is generated from this list. -->

1. **<decision>** — <why>, instead of <alternative>.

## 5. Phases

Each phase = builder → audit at the project's rigor (G6) → fixes → commit → README TODO
tick.

| # | Phase | Owner agent | Requirements | Depends on | Parallel with |
|---|---|---|---|---|---|
| F0 | Scaffold: layout, tooling, CI, `.env.example`, kit setup | main | — | — | — |
| F1 | <phase> | <builder> | <IDs> | F0 | — |

### Acceptance criteria per phase

#### F1 · <title>

- [ ] <criterion — becomes an automated test (G2)>

### Audit loop (every phase)

```
builder (TDD: red → green → refactor, mutation check on new rules)
  → /kit:audit            (the chain of the project's rigor — blocking)
  → fixes by the builder → re-audit only what failed
  → /kit:phase-done       (commit message, progress tick)
  → commit (main agent)
milestones: auditor-judgment + auditor-senior
```

## 6. Definition of done (whole project)

- Every row of `{{requirements.checklist}}` is ✅ with evidence.
- All commands of `.claude/kit.json` green; E2E of the golden paths green.
- README: install, run, env, tests, decisions, "How this was built", Progress all current.

## 7. Operational notes

<!-- Ports, boot order, known traps, anything an operator needs. -->

## 8. Status (<date>)

Done: <phases>. Next: <phase>. Blocked: <none | what and why>.
