<!-- kit:block general v1 -->
## Rules — General (`G`)

Every rule is cited by ID in reviews and commits. Auditors check them with the command or
pattern given; "Grep" means the Grep tool (ripgrep syntax), never `grep` through a shell.

G1. **Plan before code.** Every task exists in `{{task_doc}}` with its requirement ID
    (`{{requirements.idScheme}}`), dependencies and acceptance criteria before code is
    written; a scope change is written there first. Why: work that is not in the plan is not
    audited against a requirement and drifts. Check: the task ID quoted by the builder and the
    commit appears in `{{task_doc}}` (Grep the ID).

G2. **TDD.** Test first (red), minimum code (green), refactor. No logic file without its
    spec, and every acceptance criterion becomes an automated test. A bug fix brings a
    regression test that FAILS on the old code; a security or money fix also brings the
    attacker test (the exact request that exploits it) and the third-party-down test. A
    refactor without behaviour change runs the new spec against the OLD code first. The
    coverage gate ({{coverage}} % lines and branches on logic folders) lives in each runner
    config and is never lowered to make a change pass. Why: "there are tests" is not
    evidence; a test that was never red proves nothing. Check: for every file added or
    changed under a logic folder (`services/`, `hooks/`, `helpers/`, `mutations/`,
    `*.service.*`, guards, validators, jobs) a spec exists — `git diff HEAD --name-only`,
    `git ls-files --others --exclude-standard`, then Glob the sibling `__tests__/` or
    `*.spec.*`/`*.test.*`; the runner exits 0 with the gate enabled.

G3. **Mutation check, not "there are tests".** Every new or changed rule is broken on
    purpose — invert a comparison, `>` → `>=`, delete a guard, return a constant, drop the
    tenant/owner filter, skip the transaction — and some test must fail. Mutants run in
    memory (the Vitest transform recipe in `.claude/kit/mutant/`, the default). Only the
    recipe's copy-and-restore fallback (Jest, or a runner without transforms) may write the
    mutant into the file, and only while no dev server, watcher or other agent reads it:
    backup first, restore in a `finally`; the source's sha256 is identical before and after. A
    mutation run only counts on a green baseline. A surviving mutant means the TEST is
    fixed (or the commit says why that mutant cannot be killed). Report `N/N killed`. The
    fake-test patterns `FT1…FT22` below are cited by number. Why: in the source projects
    half of the first mutants survived green suites. Check: the builder report has the
    `rule → mutant → killing test` table; `auditor-tests` re-runs a sample with
    `.claude/kit/mutant/mutant.mjs`.

G4. **No dead code.** No unused exports, commented-out code, unreachable branches,
    duplicated logic, or `TODO`/`FIXME` in added lines; a refactor deletes the old path in
    the same commit. Why: dead paths get "fixed" later and diverge from the live one.
    Check: `/kit:audit quick` flags commented-out code, TODOs and exports without importers;
    by hand, Grep the added lines (`git diff HEAD -U0`) for
    `^\+\s*//\s*(const|let|var|if|for|return|await|export|import|function|class)\b`.

G5. **Readable.** Names say what the data represents; a function that does not fit a
    screen (~50 lines) or nests more than 3 levels is split; more than 2 parameters → one
    object in, one object out. Comments explain WHY, never WHAT; a test says why the rule
    matters (the bug or the money it protects). Why: the next agent reads this cold.
    Check: read the touched functions; report file:line and the simpler shape.

G6. **Audit at the project's rigor — automatically.** This project runs at rigor
    **`{{rigor}}`**. After EVERY finished task and before EVERY commit, the main agent runs
    the audit of that level without being asked:

    | Rigor | After each task and before each commit | Milestones |
    |---|---|---|
    | `full` | `/kit:audit` — the whole `audit.chain` for the touched scopes | `auditor-judgment` + `auditor-senior` |
    | `standard` | `/kit:audit` — `rules` + `tests`; the rest of the chain on demand (`/kit:audit full`) | on demand |
    | `lite` | `/kit:audit quick` — architecture, secrets and dead code (`arch-check`, no agents) | none |

    In `lite`, the ENFORCED rules are the architecture rules of the scope blocks (layout,
    layers, imports — whatever `arch-check` checks), G9 (secrets) and G4 (dead code); every
    other rule is guidance, tests are written where cheap and G3 is skipped. In every
    level nothing is "done" with an open BLOCKER or HIGH, and after fixes only the failed
    audits re-run. With `"seal": true` the kit hook blocks `git commit` until the staged
    files match the seal of a PASS. Why: the author cannot see what the author missed.
    Check: the last audit verdict is PASS for the exact paths committed
    (`.claude/kit-seal.json` when the seal is on).

G7. **Git writes by the main agent only.** Builders and auditors never run `git add`,
    `commit`, `stash`, `checkout`, `restore`, `reset`, `rebase` or `push`. Commit message:
    {{commit_format}}; the body says WHY, then a `Verified:` line (commands and counts) and
    `Mutation: N/N`, plus a `Deploy order:` line when a contract changes. The message goes
    in a file (`git commit -F <file>`); staging is its own command; `--no-verify` and
    `HUSKY=0` are forbidden. Why: several agents share one tree; one stray `checkout`
    destroys uncommitted work. Check: `git log -1 --format=%B` matches the format; agent
    reports contain no git writes.

G8. **Tracking.** When a task closes, update {{tracking_docs}}: the task status, the
    checklist row with its evidence (file:line, test name or command output) and
    {{progress_log}}. Exactly one progress log is the source of truth. Why: progress kept
    from memory is wrong by the second day. Check: the closed task's ID is ticked in
    {{progress_log}} and its checklist row has evidence, in the same commit.

G9. **Secrets.** Never in code, tests, fixtures, logs, docs, the client bundle or git.
    `.env` is git-ignored; every variable is declared in the env schema validated at boot
    (production fails closed without it), in `.env.example` with a placeholder, and in the
    env doc. Only public-prefixed variables reach a client bundle. Why: a leaked key is
    rotated, not deleted. Check: `/kit:audit quick` (tracked env files, provider keys,
    secret literals); `git ls-files '*.env' '*.env.*'` lists only `*.example` files.

G10. **Verify end to end.** Before saying "done": lint, typecheck, tests and build of every
     touched scope (the commands in `kit.json` → `commands.<scope>`), reading each EXIT
     CODE, not the summary; then the golden path in a real browser or device at the
     smallest supported viewport and at desktop. Why: green unit tests have shipped broken
     pages. Check: the builder report lists each command with its exit code
     (`<cmd>; echo "exit=$?"`).

G11. **Ambiguous or contradictory → ask, don't invent.** Write the question in
     {{progress_log}} with a proposed option marked `(proposal)`; if it changes scope, data
     model, cost or security, ask the owner before building. `{{requirements.source}}` wins
     over the checklist and the plan; report any discrepancy. Why: an invented requirement
     is a bug with good test coverage. Check: every `(proposal)` decision in the change is
     logged; no behaviour exists that no requirement or decision asks for.

G12. **One rule, one place.** A business rule (visibility, eligibility, a cap, a price
     calculation) lives in ONE function used by every door that applies it, including the
     one that charges; a rule both front and back need lives once in a shared package.
     "Twin doors": every DTO or form that receives the same field applies the same cap and
     normalization, pinned by a test that compares them; a cap shared by API and UI is one
     constant that the copy interpolates. Every business classification of an enum has a
     spec against the schema enum. Why: the second copy is the one that does not get the
     fix. Check: for each new/changed field, condition or number, Grep its name or literal
     across all scopes; two implementations is a finding.

G13. **Language.** Code, identifiers, comments, commits and docs in English. End-user copy
     (`{{locale.ui}}` by default) only through the i18n layer (`t('ns.key')`), never
     hard-coded — also `aria-label`, `placeholder`, `title`, toasts, emails, notifications
     and error copy; every key exists in every locale. Why: hard-coded copy cannot be
     translated or reviewed in one place. Check: Grep touched `.tsx`/`.astro`/`.vue` files
     for `>\s*[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡][^<{}]*<` and
     `(aria-label|placeholder|title|alt)=["'][^"'{]+["']`; diff the key sets of the locale
     files.

G14. **Multi-agent hygiene.** Each agent touches only the paths of its task. Shared files
     (error catalog, i18n locales, DB schema, module registries, env schema) are edited
     surgically — append, never rewrite or reorder. Before creating a "new" file, Glob and
     `git ls-files` for it; search with the Grep tool. A batch's state lives in a file that
     is enough to resume after a cut; once a batch closes its scope is frozen (new findings
     go to the backlog, except a HIGH in security or money). Why: parallel agents silently
     overwrite each other. Check: `git diff HEAD --stat` of shared files shows additions
     only; no file outside the task's paths changed.

G15. **Quality standard.** Rules learned the hard way live in `docs/quality-standard.md`:
     each entry tells the real bug, the correct way, how it is enforced (rule ID, census or
     test) and cites the commit that taught it. The same defect found twice becomes an
     entry; auditors read the file before auditing. Why: fixes were applied to old code and
     the next feature repeated the mistake. Check: every entry has a commit hash
     (`git cat-file -t <hash>` → `commit`) and an enforcement line.

G16. **Censuses only shrink.** A mechanical check that needs the whole repo is a script
     `scripts/census-<name>.mjs` (read-only, never opens `.env`, no network) that exits 1 on
     any NEW occurrence. Pre-existing occurrences sit in its `BASELINE` list, each with a
     reason; an entry that no longer occurs also fails, so the baseline only shrinks. Each
     census has a `node --test` spec with synthetic cases that must bite. A rule that is a
     layout, import or naming rule goes to `.claude/kit-structure/*.structure.json` instead,
     so `/kit:audit quick` checks it. Why: a rule that only lives in prose is broken by the
     next feature. Check: run every `scripts/census-*.mjs` and read the exit code.

G17. **No invisible control characters.** No raw bidi controls, zero-width spaces or
     direction marks in any text file (code, specs, docs, JSON, YAML); code that needs one
     builds it with `String.fromCodePoint`. Why: the text reads differently from what it
     executes ("trojan source"). Check: `/kit:audit quick`; by hand, Grep
     `[\x{202A}-\x{202E}\x{2066}-\x{2069}\x{200B}\x{200E}\x{200F}]` → zero hits.

G18. **No silent failure.** Every `catch` handles the error, reports it, or says in a
     comment why neither applies; no empty `catch {}`, no `except: pass`, no promise left
     floating (`void promise()` without `.catch`). Why: a swallowed error turns an outage
     into a support ticket. Check: Grep added lines for
     `catch\s*(\(\w*\))?\s*\{\s*\}`, `\.catch\(\(\)\s*=>\s*(\{\s*\}|undefined|null)\)`,
     `except(\s+\w+)?:\s*pass` and `\bvoid\s+\w+\(`.

G19. **pnpm, locked down (supply chain).** Every JavaScript package installs with pnpm
     ≥ 10.26 (the first version that reads `allowBuilds`, the only build allowlist pnpm 11
     and later still read). The root `package.json` pins it exactly in `packageManager`
     (`"pnpm@<x.y.z>"`) and every machine and CI job runs that version: pnpm switches to
     the pin by itself (`pmOnFail: download`, the default from pnpm 11), or Corepack does
     (`corepack enable`; bundled with Node.js only before 25, `npm i -g corepack` after).
     `pnpm-lock.yaml` is committed and CI installs with `pnpm install --frozen-lockfile`.
     Nobody runs `npm install` or `yarn` here: no `package-lock.json` or `yarn.lock` exists.
     Supply-chain settings live in `pnpm-workspace.yaml` (from pnpm 11, `.npmrc` holds only
     auth and registry settings and the rest of it is ignored). Dependency lifecycle scripts
     never run unless allowed (blocked by default since pnpm 10.0): each package that needs
     its build script is listed `true` in `allowBuilds` (`pnpm approve-builds`, since 10.1,
     writes it; `onlyBuiltDependencies` is its pre-10.26 spelling, removed in pnpm 11) with a
     comment saying why, after someone read that script; `strictDepBuilds: true` (the
     default only from pnpm 11) makes an unreviewed build fail the install;
     `dangerouslyAllowAllBuilds` is never set. `minimumReleaseAge: 1440` (minutes; since
     pnpm 10.16, where it defaults to 0; setting it explicitly also makes pnpm 11 strict
     about it) keeps versions younger than a day out — the window in which most malicious
     releases are found and pulled; an exception goes in `minimumReleaseAgeExclude` with a
     reason. CI runs `pnpm audit --prod`; an accepted advisory is ignored by its GHSA id with
     a reason. The isolated `node_modules` layout stays (the default `nodeLinker`), so code
     cannot import a package it does not declare; `publicHoistPattern` lists only tooling
     binaries that must resolve from the root (`*eslint*`, `*prettier*`), never runtime
     libraries. Expo supports isolated installs from SDK 54: `nodeLinker: hoisted` only when
     a native library is proven to break without it, scoped to that app (with the default
     shared lockfile the linker applies to the whole workspace, so that app gets its own
     lockfile) and recorded in an ADR naming the library and the error. Why: npm runs every
     dependency's install scripts by default and its flat `node_modules` lets code use
     packages it never declared; a hijacked release does its damage in the hours after it
     is published. Check: `node -p "require('./package.json').packageManager"` prints
     `pnpm@` plus an exact version; `git ls-files pnpm-lock.yaml` → 1 line and
     `git ls-files '*package-lock.json' '*yarn.lock'` → none; Grep the CI workflows for
     `pnpm (i|install)\b` and confirm `--frozen-lockfile` on every hit, and for
     `pnpm audit --prod` → present; Grep `pnpm-workspace.yaml` for `allowBuilds:` and
     `minimumReleaseAge:` → present, and for
     `dangerouslyAllowAllBuilds:\s*true|onlyBuiltDependencies|nodeLinker:\s*hoisted` → none
     (or the ADR exists); Grep `.npmrc` for
     `hoist|node-linker|built-dependencies|release-age` → none; Grep scripts, Dockerfiles, CI
     and docs for `\bnpm (install|i|ci)\b|\byarn (install|add)\b` → none.

G20. **One command to boot and one to test, on any OS.** The root `package.json` scripts
     are the interface every person, agent and doc uses: `docker:up` (build and boot the
     whole stack, migrated and seeded, and wait until it is healthy), `docker:down` (stop,
     keep data), `docker:reset` (wipe volumes and boot again), `test:<scope>` for each
     scope (its lint, format check, typecheck and tests; a Python scope calls `uv run …`),
     `test:web` (the same over every web package), `e2e` and `e2e:install`. Booting differs
     per OS, so `docker:up` runs a node dispatcher (`scripts/up.mjs`) that starts
     `scripts/up.ps1` on Windows and `scripts/up.sh` elsewhere: the boot logic lives once
     per shell, and it creates `.env` from `.env.example` on the first run. E2E base URLs are
     built from the ports in `.env`, never hard-coded. `make` targets, when the repo has a
     Makefile, call these scripts or the same boot script and never repeat their logic. The
     README "Quick start" and "Testing" sections give exactly these commands, each of which
     runs unchanged in PowerShell and in sh (a `pnpm <script>` line, never `export`,
     `./x.sh` or a shell-only chain as the only way). Why: a stack that boots one way on the
     author's machine is a stack a reviewer on Windows cannot run, and two copies of the
     boot logic drift apart. Check:
     `node -p "Object.keys(require('./package.json').scripts).join(' ')"` lists `docker:up`,
     `docker:down`, `docker:reset`, `test:web`, `e2e`, `e2e:install` and a `test:<scope>` per
     scope; Grep the README for `pnpm docker:up` and `pnpm e2e` → present
     under "Quick start" and "Testing"; Grep the E2E config and support files for
     `https?://(localhost|127\.0\.0\.1):\d+` → none.

### Fake-test patterns (`FT`)

The ONE list. Auditors walk it entirely over the specs of a change and cite `FT<n>`. A new
pattern is appended at the end, never renumbered.

FT1. **One-sided boundary.** The limit is tested only on the failing side; the last value
     that PASSES is untested, so `> MAX` mutated to `>= MAX` stays green (also tolerances).

FT2. **Always-true assertion.** `toBeTruthy()` on an object, `toBeLessThanOrEqual(999)`, a
     spy "was called" as the only proof.

FT3. **Generic rejection.** `rejects.toThrow()`, `rejects.toBeTruthy()` or
     `raises(Exception)` that also accepts a TypeError or a 500 — assert the error code
     (`rejects.toMatchObject({ code })`).

FT4. **Invalid base body.** "Rejects X" with a body that was already invalid for another
     reason; one case proves the base body passes and the error is asserted on THAT field.

FT5. **Coinciding fixtures.** Fields or sources share values; every field gets a unique
     value, two tenants get different data, and each switch is flipped one at a time.

FT6. **Doubles that lie.** A database double that ignores the `where`, does not throw on
     what it does not understand, or lacks the unique/partial indexes of the migration;
     data rules are tested against the real database.

FT7. **Clock or timezone dependence.** Time not fixed (fake timers) or timezone not
     pinned (`TZ` explicit, or dates built in local time).

FT8. **Mocks that render `null`.** Every stub renders its `data-testid`.

FT9. **Invalidation by literal key.** Cache invalidation asserted by a literal key or by
     the call instead of its effect — use the exported `*_KEY` and assert the query is
     invalidated with the real key shape (paginated if the query is).

FT10. **Not really mounted.** The test passes without mounting or hydrating; assert what
      the user sees (roles, labels, text), and hydration specs hydrate
      (`renderToString` + `hydrateRoot` with `onRecoverableError`, zero recoverable errors).

FT11. **No empty and no foreign case.** No case for the empty state (null user, empty list,
      absent optional field — one per guard) and, in multi-tenant code, no other-tenant case.

FT12. **Snapshot as the only assertion.** A large snapshot proves the output did not
      change, not that it is right.

FT13. **Rounding-blind fixtures.** Values where round, floor and trunc agree (0.633) or that
      do not move; pick a third decimal ≥ 5 to pin the rounding direction.

FT14. **Unused overrides.** A test helper declares an overrides parameter and never applies it.

FT15. **Orphaned tests.** "Coverage missing on purpose" comments, or tests left without an
      object after a behaviour change; rewrite them for today's behaviour or delete them
      saying why.

FT16. **Upstream normalization.** A `Math.ceil`, clamp, trim or lowercase upstream already
      does what the test believes it verifies.

FT17. **Validation without production metadata.** The validation spec builds its own
      schema or pipe; use the real DTO from its file through the production validation pipe.

FT18. **Invented error shapes.** Errors or states simulated in a shape the library never
      produces; copy the shape from the library's source.

FT19. **Order-dependent checks.** Two checks whose order matters, with no case that
      satisfies both.

FT20. **Allowlist by absence.** An allowlist tested with "does not contain X"; assert the
      EXACT key set.

FT21. **Impossible input.** An input the real component never delivers; test it as it
      arrives — keystroke by keystroke, pasted, prefilled.

FT22. **Fake contract.** A double of a contract nobody meets (a fake analytics global, a
      stubbed toaster); integrations are tested with the REAL library and real providers.

### Definition of done

A task is done when: its acceptance criteria are automated tests that a mutant fails (G2,
G3; in `lite`, tests where cheap); lint, typecheck, tests and build are green for every
touched scope (G10); the audit of the project's rigor has no open BLOCKER or HIGH (G6); no
hard-coded UI copy (G13); the golden path works at the smallest viewport and at desktop
(G10); and the tracking docs are updated in the same commit (G8).
<!-- /kit:block general -->
