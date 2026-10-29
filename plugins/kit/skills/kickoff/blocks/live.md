<!-- kit:block live v1 -->
## Rules — Live coding (`L`)

A timed pairing session on code you did not write: about an hour, shown on a shared screen.
These rules replace the stack blocks for the session. The project's own conventions win where
they exist, everything that existed at the baseline is Pre-existing, and only the diff counts.

L1. **Plan before code.** Every step is a row of `.live/plan.md` with the name of its first
    failing test written before the code; a change of scope is folded in with
    `/kit:live-plan --amend` first. Why: work outside the plan is audited against nothing and
    eats the clock. Check: the step ID in the commit subject is a row of the plan.

L2. **Ask before assuming.** An ambiguity that changes behaviour, data, security or cost is a
    question to the human with a recommended answer, not a guess. Every answer or assumption
    is logged in `.live/decisions.md`. Why: an invented requirement is a bug with good
    coverage. Check: no behaviour exists that no requirement or decision asks for.

L3. **Characterize before changing.** Untested code that a step touches gets ONE test that
    pins today's behaviour of that path, passing, before the first edit. Why: otherwise a
    regression and a fix look the same. Check: the step report shows the pinning test green
    before the change.

L4. **Red first, for the right reason.** New behaviour starts with a test that fails on an
    assertion about that behaviour (not on an import or a typo), seen failing in the run
    output; a bug fix starts with a regression test that fails on the old code. Why: a test
    that was never red proves nothing. Check: the report quotes the failing line.

L5. **Smallest change, focused diff.** The least code that turns the test green. No drive-by
    renames, formatting or refactors; a refactor runs on green, in its own step; no new
    dependency without asking. Why: reviewers read the diff, and noise hides bugs. Check:
    `git diff --stat <base>` lists only the step's files.

L6. **Edge matrix per step.** For each new rule: the boundary pair (last value that passes,
    first that fails), empty or absent input, a duplicate, a wrong type, and the failure of
    every dependency (error, timeout). Errors are asserted by code or type, never just
    "throws". Why: bugs live on boundaries. Check: a named test per case (FT1, FT3, FT4, FT11).

L7. **Security lens.** For anything that takes input, reads or writes data, or calls out: who
    may do this (authentication and ownership checked on the server, never from an id the
    client sends); input validated at the boundary (type, size, allowlist); queries
    parameterised; responses carry only the fields needed; no secrets or personal data in
    code, logs or errors; outbound URLs and uploads restricted. Why: these are the holes every
    review finds first. Check: the step report answers each question that applies;
    `/kit:live-ask` and `auditor-security` read the same list.

L8. **Errors are handled.** No empty catch, no swallowed rejection, no `return null` that
    hides a failure; users get a stable error code, internals stay in logs. Why: a swallowed
    error turns into an outage nobody sees. Check: Grep added lines for
    `catch\s*(\(\w*\))?\s*\{\s*\}`, `except(\s+\w+)?:\s*pass`, `\.catch\(\(\)\s*=>\s*\{?\s*\}?\)`.

L9. **Do not break the baseline.** Tests that were red before the first edit are listed in
    `.live/baseline-tests.txt` and stay as they were; every step ends with the suite no worse
    than that baseline. Why: you answer for what you changed, but only if you can prove what
    was already broken. Check: counts against the baseline in every step report.

L10. **Tests assert behaviour, and bite.** Assert what a caller observes, with a unique value
     per field; no snapshot as the only assertion; once per step the most important condition
     is broken on purpose (invert it, move the boundary, delete the guard), a test must fail,
     and the exact original is restored. Why: green suites hide dead assertions. Check: the
     `mutant → killed by <test>` line; the FT list below.

L11. **Evidence, not claims.** Every "done" carries the command and its exit code or output
     line; "should work" is not a status. Why: the next reader cannot rerun your memory.
     Check: step reports list commands with exit codes.

L12. **Small tagged commits.** One step, one commit, only after the human says yes: the subject
     starts with `[ADD]`, `[FIX]`, `[REFACTOR]`, `[TEST]`, `[DOCS]` or `[CHORE]` and the step
     ID; the body says why and ends with a `Verified:` line; staging and commit are separate
     commands; never `--no-verify`. Why: history is part of the work. Check:
     `git log --oneline <base>..`.

L13. **Clean diff.** No debug prints, TODO/FIXME, commented-out code, unused exports or
     invisible characters in added lines. Why: they ship. Check: `/kit:live-audit --quick`
     (arch-check).

L14. **Park, do not expand.** Anything outside the plan (an idea, a smell, a risk) goes to
     `.live/parked.md` in one line and into the wrap-up; scope grows only through an approved
     `--amend`. Why: an hour is won by finishing the asked thing well. Check: `parked.md`
     against the diff.

### Question lenses (what the AI asks the human)

At most three per gate, about the code or plan in front of you; park the rest.

- **Scope** — what does "done" mean? who uses it? what is explicitly out?
- **Data and state** — migrations, backwards compatibility, idempotency, concurrency, ordering, time zones, money rounding.
- **Failure** — timeouts, partial failure, retries, empty or huge input, duplicates, a dependency that is down.
- **Security** — who may do this; what the client is trusted to send; what leaves the system; secrets and personal data in logs; uploads and URLs; abuse and rate limits.
- **Performance** — unbounded lists, N+1 queries, work done per request that could be done once.
- **UX and errors** — loading, empty and error states; what the user sees on failure.
- **Tests** — what would make this test pass while the code is wrong?

### Fake-test patterns (`FT`)

- FT1. One-sided boundary: only the failing side of a limit is tested.
- FT2. Always-true assertion: `toBeTruthy()` on an object, a spy "was called" as the only proof.
- FT3. Generic rejection: `rejects.toThrow()` / `raises(Exception)` with no code.
- FT4. Invalid base body: the "rejects X" case was already invalid for another reason.
- FT5. Coinciding fixtures: two fields or tenants share a value.
- FT6. Doubles that lie: a database double that ignores the filter or the constraints.
- FT7. Clock or timezone dependence: time not fixed.
- FT8. Mocks that render nothing.
- FT9. Cache invalidation asserted by a literal key or by the call instead of its effect.
- FT10. Not really mounted: the test passes without rendering what the user sees.
- FT11. No empty case and no foreign-owner case.
- FT12. Snapshot as the only assertion.
- FT13. Rounding-blind fixtures: values where round, floor and trunc agree.
- FT14. Unused overrides: a test helper takes overrides and never applies them.
- FT15. Orphaned tests left without an object after a behaviour change.
- FT16. Upstream normalisation already does what the test believes it verifies.
- FT17. Validation spec builds its own schema instead of the production one.
- FT18. Invented error shapes the library never produces.
- FT19. Order-dependent checks with no case that satisfies both.
- FT20. Allowlist tested by absence instead of the exact key set.
- FT21. Impossible input the real caller never delivers.
- FT22. Fake contract: a double of something nobody provides.
<!-- /kit:block live -->
