# Progress — {{project}}

The single progress log (G8). Newest entry on top. Each entry says what was finished (with
IDs), what is next, what is blocked, and which decisions the owner must take. Task details
live in `docs/backlog.md`; evidence per requirement in `{{requirements.checklist}}`.

---

## <YYYY-MM-DD> · <block of work, with task IDs>

### Done

- **<T-ID> <title>** — <one line on what now works for the user>.

### Next

- <T-ID> <title>

### Blocked

- <T-ID> — <why, and who unblocks it> (or "nothing")

### Decisions (applied and tested; confirm the ones marked _(proposal)_)

- _(proposal, G11)_ **<question>** — read as <interpretation>, because <reason>. If the
  owner prefers <alternative>, <what changes>.
- _(decision)_ **<decision>** — <why>.

### For the owner

- <env variables to set by hand, deploy order, OTA vs native build, live checks>

### Verification

- <command> → exit 0 (<counts>) · mutation <k>/<n> killed · audit: <auditors> PASS
