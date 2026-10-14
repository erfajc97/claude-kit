# Quality standard — learned the hard way

> These are NOT generic good practices. Every entry comes from a REAL bug of this
> repository (G15). `CLAUDE.md` says how the code is organised; this file says what goes
> WRONG. Auditors read it before every audit; a change that repeats an entry is at least a
> HIGH finding.

## How it is enforced

From cheapest to most expensive:

| Layer | Catches | When it runs |
|---|---|---|
| `/kit:audit quick` (structure specs, `.claude/kit-structure/`) | layout, layers, imports, names | every task, zero tokens |
| `scripts/census-*.mjs` (G16) | patterns that need the whole repo; baselines only shrink | CI and before commits |
| Tests | what only running shows | `commands.<scope>.test` |

When the same defect shows up twice, it becomes an entry here AND, if it is mechanical, a
census or a structure check.

## Entry format

Each entry: the symptom in one title line, the real bug with its commit hash, the correct
way (with code when it helps), and how it is enforced now.

```markdown
## N. <the rule, as a short imperative or a fact>

<What happened: the bug, who it hit, what it cost — with the commit that fixed it (`abc1234`).
How many times it appeared.>

**The correct way:**

<code or steps>

**Enforced by:** <rule ID> · <census or structure check> · <test name>.
```

---

<!-- Entries start here, numbered, append-only. -->
