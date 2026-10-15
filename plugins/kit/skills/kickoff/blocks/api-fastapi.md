<!-- kit:block api-fastapi v1 -->
## Rules — FastAPI + SQLAlchemy 2 (`AF`)

The stack-agnostic API rules are `A1…A20`; these say how each one is done in FastAPI,
Pydantic v2, SQLAlchemy 2 (async), Alembic and uv, for every scope of kind api with stack
`fastapi`.

AF1. **Feature-sliced package; `core` never imports a feature.** `{{scopes.api.path}}`
    follows (A1 in FastAPI terms):
    ```
    src/<package>/
      main.py                 create_app(): routers, middleware, error handlers, lifespan
      cli.py                  migrate / seed entry points (open their own engine from settings)
      core/                   config/ (settings, limits)  db/  errors/  http/  storage/
                              clock.py  logging.py  dependencies.py
      features/<feature>/
        router.py  schemas.py  service.py  repository.py  models.py  dependencies.py  errors.py
        domain/  providers/  helpers/  jobs/      optional subpackages, each with __init__.py
    migrations/versions/<NNNN>_<name>.py
    tests/{unit,integration}/{features/<feature>,core/<package>}/   tests/conftest.py
    ```
    Only those layer modules sit at a feature root, and a layer module exists only when
    the feature needs it; everything else lives in a named subpackage (no star imports).
    `router.py` is HTTP only: parse, call the service with the request's session, map to the
    response DTO, set the status; it never builds a query or imports a repository.
    `repository.py` is data access only and never imports `fastapi` or `starlette` (it
    raises no HTTP error). `domain/` is pure: no `fastapi`, `starlette`, `sqlalchemy`,
    HTTP client or storage SDK, and never a router, service, repository, `models` or
    `schemas` module. `core/` never imports a feature. An architecture test in
    `tests/unit/architecture/` walks every module's imports with `ast` (both
    `import a.b` and `from a.b import c`, since `from pkg.features.x import repository`
    imports a module by name) and fails on each of these. Why: the tree says what the API
    does and the import direction keeps a change inside one slice. Check: `/kit:audit quick`
    (layout, domain and repository purity, core → feature); the architecture test passes;
    Grep `^\s*(from|import)\s+[\w.]*\.features\b` in `core/` → none.

AF2. **SQLAlchemy 2 query builder only.** Every query is a `select()` / `insert()` /
    `update()` / `delete()` expression with bound parameters (A2). `sqlalchemy.text`,
    `TextClause`, `literal_column`, `exec_driver_sql` and a string, f-string or `%` passed
    to `execute()` are banned, enforced by ruff `flake8-tidy-imports.banned-api` (TID251)
    on the whole `sqlalchemy.text` family. A list endpoint parses its query into a typed
    filter object (Pydantic model or frozen dataclass), and ONE repository function composes
    the `Select` from it: one `where` per present field, sort from an allowlist mapped to
    columns plus a unique tiebreaker, limit and offset from the A3 floor and ceiling. Each
    request gets one `AsyncSession` from a dependency (`async_sessionmaker(...,
    expire_on_commit=False)`); the service owns the transaction. Relationships declare
    `lazy="raise"` and every load is explicit (`selectinload` / `joinedload`): an implicit
    lazy load in async code fails at runtime (`MissingGreenlet`). Why: one interpolated
    fragment is an injection, and filters built ad hoc per endpoint drift apart. Check:
    `pyproject.toml` lists the `banned-api` entries and selects `TID`; Grep
    `\bsa\.text\(|\bsqlalchemy\.text\(|literal_column\(|exec_driver_sql\(|\.execute\(\s*[fbr]?["']`
    in the source → none; Grep `relationship\(` lines and confirm `lazy="raise"`.

AF3. **Strict Pydantic DTOs, shared limits, no mass assignment.** Request DTOs set
    `model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)` (on each class or
    one shared base); body booleans and numbers are `StrictBool` / `StrictInt` / `Strict…`
    (or `Field(strict=True)`), so `"false"` is not `True` and `""` is not `0`; every `str`
    has `min_length` / `max_length`, every list `max_length`, every `Decimal`
    `max_digits` / `decimal_places`, all taken from ONE limits module
    (`core/config/limits.py`) that the ORM columns and CHECK constraints import too (A3).
    Request and response are separate classes; every route declares its response DTO
    (`response_model` or the return annotation) and builds it explicitly, never returning
    an ORM object (A5). ORM rows are created and updated field by field from the DTO;
    never `Model(**dto.model_dump())`, `**payload.model_dump()` into a write, or a `setattr`
    loop over a dump; a partial update reads `model_fields_set` to tell "not sent" from
    `null` and validates the merged state (A4). Why: Pydantic coerces by default, and a
    cap that differs from its column is a 500. Check: Grep `class \w+\(BaseModel\)` in
    `schemas.py` and confirm each request DTO forbids extra keys; Grep
    `\*\*\w+\.model_dump\(|setattr\(` in services and repositories → none; A3's boundary
    tests import the real DTO (FT17).

AF4. **`Decimal` money, aware datetimes.** Amounts are `Decimal` in models and DTOs and
    `Numeric(precision, scale)` columns with both values from the limits module; never
    `float` (A6); Pydantic emits `Decimal` as a string in JSON mode, which is the A6
    contract. Timestamps are `DateTime(timezone=True)`; "now" comes from an injected clock
    dependency (`datetime.now(UTC)` in one place) so tests freeze it (FT7); ruff `DTZ` is
    on. Why: binary floats and naive datetimes corrupt data silently. Check: Grep
    `\bfloat\b|Float\(` in `models.py`, `schemas.py` and services next to amount fields →
    none; Grep `datetime\.now\(\)|datetime\.utcnow\(` → none.

AF5. **`AppError(HTTPException)` and one set of handlers.** Services raise
    `AppError(ErrorCode.X, details=…)`, where `AppError` subclasses `HTTPException` and takes
    its status and default message from the single catalog (`core/errors/codes.py`). As
    an `HTTPException`, FastAPI treats it as the HTTP error it is (a dependency that raises
    it still answers correctly), and its own handler, registered for the subclass, wins
    over the generic one because handlers are looked up along the MRO. One
    `register_error_handlers(app)` turns `AppError`, Starlette `HTTPException` (404, 405,
    malformed bodies), `RequestValidationError`, `IntegrityError` and any other exception
    (500, logged once with the request id, G18) into the A7 envelope. Why: one place decides
    status, code and redaction. Check: Grep `raise HTTPException\(` outside `core/errors/`
    → none; one handler test per source; a test proves every `ErrorCode` member has a
    catalog entry and copy in every locale (A7).

AF6. **Settings only through pydantic-settings.** One `Settings(BaseSettings)` in
    `core/config/` declares every variable (A8); secrets are `SecretStr`; a validator
    refuses development defaults in production; it is built once at startup and reaches
    code through a dependency (tests override it). Ruff `banned-api` bans `os.environ` and
    `os.getenv`, so nothing else reads the environment. Why: a missing secret must stop the
    boot, not the first request. Check: the `banned-api` entries exist; Grep
    `os\.environ|os\.getenv` outside `core/config/` → none; a test builds production
    settings with a development default and expects a `ValidationError`.

AF7. **Third-party I/O behind ports, with timeouts.** A9 with httpx: each provider is an
    adapter in the feature's `providers/` (or `core/storage/`) implementing a
    `typing.Protocol` port declared in `domain/`; a factory picks the adapter from settings.
    Only adapters import `httpx` or a vendor SDK; each `httpx.AsyncClient` is created once
    with an explicit `httpx.Timeout`, opened in the lifespan or the factory and closed on
    shutdown; timeouts and 5xx map to catalog codes. A provider without an SLA on a
    critical path is hedged (A20): `asyncio.timeout` for the one deadline,
    `asyncio.wait(..., return_when=FIRST_COMPLETED)`, then `cancel()` and
    `asyncio.gather(*tasks, return_exceptions=True)` so the loser is awaited. Tests swap
    adapters through `app.dependency_overrides` or fake the transport with `respx`, never
    `monkeypatch` a module attribute. Why: a hung vendor must not hang the API, and tests
    must not need the network. Check: Grep `^\s*(import|from)\s+(httpx|aioboto3|boto3)\b`
    outside `providers/` and `core/storage/` → none; Grep `AsyncClient\(` and confirm a
    `timeout=`; Grep `monkeypatch\.setattr\(` in tests → each one justified.

AF8. **Async all the way.** Routes and services are `async def` on an async database
    driver (`asyncpg`). Nothing blocks the event loop: CPU or blocking work (Pillow, password
    hashing, large file parsing, a sync-only SDK) runs through
    `starlette.concurrency.run_in_threadpool` or `asyncio.to_thread`, and work that can take
    seconds goes to a background task or queue (A10). Never `requests`, `time.sleep` or a
    sync database driver in the app. Ruff `ASYNC` is on. Why: one blocking call stalls every
    request the worker is serving. Check: Grep `^\s*(import|from)\s+requests\b|\btime\.sleep\(`
    in the source → none; Grep `from PIL|argon2|bcrypt` and confirm each call site runs
    through `run_in_threadpool|to_thread`.

AF9. **`mypy --strict`.** `[tool.mypy] strict = true` over the source, tests and migrations,
    with `plugins = ["pydantic.mypy"]` and `warn_unreachable = true` (A16). `Any` only at a
    true boundary with a comment; every `# type: ignore[<code>]` names its code and says
    why; `ignore_missing_imports` only per untyped third-party module in `overrides`. Why:
    types are the cheapest test, and Pydantic and SQLAlchemy 2 are fully typed. Check:
    `{{commands.api.typecheck}}` exits 0; Grep `# type: ignore\s*$` → none; Grep
    `ignore_missing_imports = true` outside `[[tool.mypy.overrides]]` → none.

AF10. **Hand-written Alembic migrations with a drift test.** Revisions are written by hand
    with `op.*` (`create_table`, `create_check_constraint`, `create_foreign_key(...,
    ondelete=...)`, `create_index`, partial indexes with `postgresql_where`); a literal
    `op.execute("…")` only for DDL Alembic has no operation for (an extension, a trigger),
    with a comment; autogenerate output is at most a draft, reviewed before it is saved
    (A11). Files and revision ids are ordered and descriptive (`0005_<what_changed>`); a
    revision freezes the literal limits it was written with, so a later change to the
    limits module is a new revision. `env.py` reads the URL from the settings and targets
    `Base.metadata` with every feature's models imported. Test schemas come only from the
    real revisions, never `metadata.create_all()`. A drift test upgrades a fresh Postgres
    to head and asserts `compare_metadata(...)` returns `[]`; the integration setup also
    runs upgrade → `downgrade base` → upgrade, so every downgrade works. Why: a model
    without its migration fails in production, and only the constraints in the schema are
    what the database enforces. Check: the drift test passes; Grep `create_all\(` in tests
    and app code → none; every new filter or sort column has an index in its revision.

AF11. **Tooling through uv, with the coverage gate.** uv manages Python
    (`.python-version`) and dependencies: `uv.lock` is committed, and CI and Docker install
    with `uv sync --locked`, which fails on a stale lock; dev tools live in
    `[dependency-groups] dev`. The scope's commands are `uv run ruff check .`,
    `uv run ruff format --check .`, `uv run mypy` and `uv run pytest --cov` (A19). Ruff
    selects at least `E, W, F, I, B, UP, S, ASYNC, BLE, DTZ, T20, TID, ERA, PT, RUF` and
    configures `banned-api` (AF2, AF6). Coverage: `[tool.coverage.run] branch = true` over
    the package, `concurrency = ["thread", "greenlet"]` (async SQLAlchemy runs in
    greenlets; without it, lines after a database await show as uncovered) and
    `[tool.coverage.report] fail_under = {{coverage}}` (G2). Why: a gate in `pyproject.toml`
    fails CI, a gate in a README does not. Check: run `{{commands.api.lint}}`,
    `{{commands.api.typecheck}}` and `{{commands.api.test}}` and read each exit code; Grep
    `pyproject.toml` for `fail_under`, `banned-api` and `strict = true` → present; Grep CI
    and Dockerfiles for `uv sync` and confirm `--locked` (or `--frozen`).

AF12. **pytest, mirrored tree, real Postgres.** Runner `{{testRunner.api}}` (pytest with
    pytest-asyncio, `asyncio_mode = "auto"`, `--strict-markers`). Tests mirror the source:
    `tests/{unit,integration}/features/<feature>/`, `tests/{unit,integration}/core/<package>/`,
    plus `unit/architecture/` (AF1) and `integration/schema/` (AF10); fixtures in
    `conftest.py`, helpers in `tests/support.py`, row builders in `tests/factories.py`.
    Unit tests drive services through fakes behind the ports and dependency overrides.
    Integration tests run against real Postgres (and the real storage service) through
    Testcontainers: session-scoped containers started lazily, the schema from the real
    revisions, each test inside a transaction that is rolled back
    (`join_transaction_mode="create_savepoint"`, so the code's own commits become
    savepoints), and the HTTP stack through `httpx.AsyncClient(transport=ASGITransport(app))`
    with the lifespan run (`asgi-lifespan`). Errors are asserted by code
    (`response.json()["error"]["code"]`, `exc_info.value.code is ErrorCode.X`), never
    `pytest.raises(Exception)` (FT3). Tests that call real third parties carry a `live`
    marker excluded by default. Why: a session double cannot prove a `where`, a constraint
    or a migration (A17, FT6). Check: `{{commands.api.test}}` exits 0 with Docker up; Glob a
    test module at the mirrored path for each new source module; Grep
    `pytest\.raises\(Exception\)` in tests → none.

AF13. **structlog JSON with a request id.** structlog renders JSON in containers (console
    in development) with `structlog.contextvars.merge_contextvars` first in the chain;
    stdlib logging (uvicorn, SQLAlchemy) is routed through it, so every line is JSON. A
    middleware binds `request_id` (the incoming `X-Request-ID` when it is a safe token,
    else a new UUID), returns it in the response header and clears the context after the
    request; the error handlers read the same id (A15). A processor masks sensitive keys;
    `print(` is banned (ruff `T20`). Why: one id joins the user's report, the log line and
    the error envelope. Check: a test with `structlog.testing.capture_logs` sees the
    request id on a log line and the same id in the header and the envelope; ruff selects
    `T20`.

AF14. **Mutation check with pytest.** G3 for this scope uses the shared recipe's
    copy-and-restore mode, which is runner-agnostic: it backs the file up, writes the
    mutant, runs any command, restores the original in a `finally` and verifies its
    sha256 (the in-memory mode exists only for Vitest). From the repo root:
    `node .claude/kit/mutant/mutant.mjs --mode copy --cwd <scope path> --file src/<package>/features/<feature>/service.py --from '<snippet>' --to '<mutant>' -- uv run python -B -m pytest tests/unit/features/<feature> -x`.
    `python -B` keeps the mutant's bytecode out of `__pycache__` (a same-size mutant
    restored within the same second would otherwise be loaded again from the stale
    `.pyc`); no `--cov` (a coverage gate on a subset fails the run without a failing test,
    which reads as INVALID); pytest's final summary (`1 failed, … in 0.42s`) must reach
    the output, since that line is what marks the mutant KILLED. Copy mode runs only while
    no `--reload` server, watcher or other agent reads that file (G3); `auditor-tests`
    never runs it — it reasons the mutant and re-runs nothing on disk. Why: the kit's
    in-memory runner is a Vitest transform, so for pytest the file itself must change, and
    only a backed-up copy verified byte for byte keeps that safe. Check: the
    builder report's mutation table lists each command with `KILLED` and `sha256
    unchanged`; `git status` shows no source change after the run.
<!-- /kit:block api-fastapi -->
