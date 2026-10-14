<!-- kit:block api-common v1 -->
## Rules — API, any backend stack (`A`)

A1. **Feature modules with layers.** Each domain is one module (feature slice) under
    `{{scopes.api.path}}`: controller/router = HTTP only (parse, access marker, call the
    service, map to the response DTO, status code); service = business rules and the
    transaction boundary; repository = data access only (returns rows, never raises HTTP
    errors), created when queries are not trivial; DTOs = request and response as SEPARATE
    types. Cross-cutting code lives in `core/` (config, database, errors, http, auth,
    storage, queue, logging) and `core/` never imports a module; a module never imports
    another module's repository. A layer file exists only when the module needs it.
    Why: the folder tree says what the system does and a change stays inside one slice.
    Check: an architecture test in the suite walks imports and fails on `core → module`,
    `controller → repository` and cross-module repository imports; spot-check with Grep
    for `modules/` or `features/` imports under `core/`.
A2. **No SQL in strings.** Queries go through the ORM / query builder or parameterized
    tagged templates. No string concatenation or interpolation into SQL, no unsafe raw
    APIs, no SQL built from user text. Migrations use the migration tool's DDL.
    Why: one interpolated fragment is an injection. Check: lint bans the unsafe APIs;
    Grep `\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(|sqlalchemy\.text\(|execute\(f["']|(SELECT|INSERT|UPDATE|DELETE) .*\$\{`
    in changed files → none.
A3. **Strict, validated DTOs with shared limits.** Every body, query and param is a DTO:
    unknown keys rejected (strict / forbid extra); body booleans and numbers are NOT
    coerced (`"false"` is not `true`, `""` is not `0`); every string trimmed, minimum
    measured after trim, and capped with the SAME constant as its DB column (one limits
    module); every array has a max length; numbers have min/max; enums validated;
    pagination has a floor and a ceiling (`page ≥ 1`, `1 ≤ limit ≤ 100`) and a stable
    sort from an allowlist. Twin doors reuse the same field definition (G12). Why: the DTO
    is the attack surface, and a cap that differs from the column turns into a 500.
    Check: Grep `z\.string\(\)|@IsString\(\)|: str\b` in DTO files and confirm each hit
    carries its cap (`.max(`, `@MaxLength`, `max_length`); each DTO has a test where the
    base body passes, then the last passing and the first failing value of each cap (FT1,
    FT4).
A4. **No mass assignment; PATCH validates the merged state.** DTO → persistence fields
    are mapped one by one; never spread a request body into a write. A partial update
    loads the stored row, merges (`{ ...stored, ...patch }`), validates the MERGED state
    against the business rules and writes explicit values; "not sent" (`undefined`) keeps
    the stored value, `null` clears it. A new field appears in every create/update mapping
    with a test that reads it back. Prices, totals and ownership are derived server-side,
    never taken from the client. Why: a spread lets clients write columns they must not,
    and validating only the patch lets invalid combinations through. Check: Grep
    `data:\s*\{\s*\.\.\.(dto|body|input|payload)|\*\*(dto|payload|body)\.(model_)?dump\(|Object\.assign\([^,]+,\s*(dto|body)`
    → none.
A5. **Responses are allowlists.** Every response is mapped to a response DTO or an
    explicit field selection: never the raw entity (no password hashes, tokens, internal
    flags, other owners' ids). Private responses are never stored by shared caches
    (`Cache-Control: private, no-store`; never `s-maxage` on private data). A GET never
    changes state. Why: returning the entity leaks every column added later. Check: Grep
    handlers/services returning ORM results without a select/mapper; Grep `s-maxage` on
    authenticated routes; Grep GET handlers that call write methods; integration tests
    assert the EXACT response key set (FT20).
A6. **Money is never float; time has types.** Amounts are fixed-point decimals end to end
    (DB `NUMERIC`/`Decimal(p,s)`, a decimal type in code, a decimal string in JSON) with a
    currency; never float arithmetic; round once, at the end. Instants are `timestamptz`
    (UTC), business dates are `date`; the business time zone comes from configuration.
    Payments, idempotency and money locks follow `addon-money` (`MO`) when it is enabled.
    Why: `0.1 + 0.2` and naive timestamps are silent data corruption. Check: Grep money
    columns typed `Float|Double|REAL|float` and `parseFloat\(|Number\(` / `float\(` on
    amount fields → none.
A7. **One error envelope, one code catalog.** Services raise a domain error with a code
    from ONE catalog; one global handler turns every error (domain, framework, validation,
    DB constraint, unexpected) into the same envelope with at least `code`, `message`,
    `details?` and `requestId`. Business errors carry no free-text message (ids go in
    `details`); clients branch on `code`, never on `message`. No stack traces or internals
    leak; an unexpected error is logged once with its request id and answered as a generic
    500 code (no silent failure: G18). A missing resource, or one that belongs to someone
    else, is 404 (never 403: do not reveal existence). "Not confirmed / pending" is never
    a 2xx. A new code is added to the catalog first, then its copy in every locale, then a
    test asserting the code (`rejects.toMatchObject({ code })` / `exc.value.code ==`, FT3).
    Why: one shape lets every client translate and handle errors; free text cannot be
    localized or matched. Check: Grep framework exceptions thrown outside the handler
    (`new (BadRequest|NotFound|Forbidden|Unauthorized|Conflict)Exception\(`,
    `raise HTTPException\(`) → none; a test proves every catalog code has copy in every
    locale.
A8. **One config module, validated at boot.** The env schema G9 requires is parsed ONCE,
    at startup, by the config module, which is the only reader of `process.env` /
    `os.environ`; services receive typed settings. Production refuses to start on a
    missing secret OR a development default; development shortcuts additionally require a
    non-production environment. Error messages name the keys, never the values. Why: a
    missing secret must stop the deploy, not the first request. Check: Grep
    `process\.env\.|os\.environ|os\.getenv` outside the config module (seeds and scripts
    aside) → none; a test boots with a production env missing a secret and expects a
    non-zero exit.
A9. **Third-party I/O behind a port, with timeouts.** Every external call (HTTP APIs,
    storage, mail, SMS, payments, LLMs) goes through an interface with an adapter; only
    the adapter imports the vendor SDK; every call has a timeout (`AbortSignal.timeout`,
    client timeout, or a `withTimeout` wrapper for clients without signals) and maps
    failures to catalog codes; tests swap the adapter for a fake, never patch internals.
    A URL chosen by a user is never fetched without an allowlist (SSRF). A timeout or 5xx
    is "unknown", not "no": it is never treated as a failure that can be refunded or
    retried blindly. Why: a hung vendor must not hang the API, and a test must not depend
    on the network. Check: Grep `fetch\(|axios\.|httpx\.|requests\.` and vendor SDK imports
    outside adapter folders → none; each adapter call has a timeout.
A10. **Background work off the request.** Anything that can take more than a few seconds
    (AI, imports, exports, bulk e-mail/SMS/push, reports, reminders) runs in a queue or
    background task: the request returns 202 with a status resource. Jobs are idempotent
    (deterministic job id), retried with backoff, and their final failure is reported.
    Queue and cache connections are lazy (never opened at import time), with no reconnect
    loops and no polling without a stop condition. Why: proxies cut long requests and the
    client retries, doing the work twice; eager connections burn paid resources. Check:
    Grep `new (Redis|Queue|Worker)\(` and confirm none runs at module top level; Grep
    `setInterval\(` and confirm each has a stop condition; job ids are derived from the
    payload.
A11. **Hand-written migrations with constraints and indexes.** Migrations are reviewed
    DDL written or edited by hand, never applied by an interactive/auto tool against a
    shared database (`prisma migrate dev`, `prisma db push`, unreviewed autogenerate).
    They are additive (expand → backfill verified → contract), carry their constraints
    (`NOT NULL`, `CHECK`, `UNIQUE` incl. partial, FK with an explicit `ON DELETE`) and an
    index for every column used in a filter, sort or join. Once applied anywhere shared, a
    migration is never edited: changes are new migrations, timestamped with the real time
    and ordered after the last one. A drift test proves migrations build exactly the
    declared schema. Why: auto tools propose dropping what only lives in SQL (partial
    indexes, CHECKs). Check: Grep docs, scripts and package files for `migrate dev|db push`
    → none; the drift test passes; every new filter/sort column has an index in the
    migration.
A12. **HTTP security baseline.** Security headers (helmet or equivalent); JSON body
    ≤ 1 MB (uploads have their own limits); CORS from an env allowlist (never `*` with
    credentials) with every custom header listed; a global rate limit plus stricter limits
    on auth, OTP, password reset, public forms and every endpoint that costs money
    (paid third parties, presigned uploads, e-mail/SMS); passwords hashed with Argon2id
    (or bcrypt); tokens never in URLs (except hashed single-use links); `JSON.parse` of
    external input in try/catch and validated after; no regex built from user text;
    objects from users never merged without filtering `__proto__`/`constructor`; webhooks
    verify the signature and process only what it covers; no PII, tokens or secrets in
    logs, analytics or error reports. Why: these are the holes every audit finds first.
    Check: Grep the bootstrap for headers, body limit, CORS and throttler; Grep
    `new RegExp\(`, `JSON\.parse\(`, `[?&](token|access_token|id_token)=` in changed files.
A13. **Uploads are capped and verified.** Files go to private storage through the storage
    port: the server builds the key (`<owner>/<kind>/<uuid>`), enforces a MIME allowlist
    (never SVG or HTML), a size cap in the signed policy or the multipart limits (plus
    file count and text-field caps), and sniffs the real type from magic bytes after
    upload; downloads use short-lived signed URLs (≤ 5 min) with `attachment`. A file or
    image URL sent by a client is accepted only if it points to our storage and belongs to
    that owner and resource; the server re-derives the key. Why: upload endpoints are the
    cheapest path to stored XSS and storage abuse. Check: Grep upload handlers for the
    MIME allowlist, size limits and magic-byte check; an integration test uploads a
    renamed SVG and an oversized file → rejected with their codes.
A14. **Access is explicit and default-deny.** Every route declares exactly one access
    marker (public, authenticated, role/permission, …); a route without one is denied at
    runtime AND fails a route-discovery test in CI. Ownership is checked in the service
    query (`where owner = …`), not after loading. Why: a forgotten decorator must break
    the build, not expose data. Check: the route-discovery test lists 0 unmarked and 0
    double-marked routes; Grep new public markers and justify each.
A15. **Structured logs with a request id.** Logs are structured (JSON in containers);
    every request gets one id (accepted from `X-Request-ID` or generated), returned in the
    `X-Request-ID` response header and in every error envelope, and propagated to jobs it
    enqueues; logs carry ids and enums, never PII, tokens or secrets (a redaction list
    covers auth headers, cookies, passwords). Why: one id joins the user's report, the log
    and the trace. Check: Grep `console\.log|print\(` in source → none; an integration
    test asserts the header and the envelope share the id.
A16. **Strict typing.** TypeScript `strict: true` with lint `no-explicit-any`, or Python
    `mypy --strict`; `any` / `Any` only at true boundaries with a comment saying why; no
    `@ts-ignore` / `type: ignore` without a reason. Why: types are the cheapest test.
    Check: `{{commands.api.typecheck}}` exits 0; Grep `as any|: any\b|@ts-ignore|# type: ignore$`
    in changed files.
A17. **Unit and integration tests, errors by code.** Services are unit-tested with
    hand-written fakes; data rules (filters, uniqueness, constraints, locks, ownership)
    are tested against a real database (container or throwaway database), never a DB
    double (FT6). Each endpoint's integration test covers the happy path, a validation
    failure with a base body that passes first (FT4), an access denial and a 404 for a
    missing or foreign resource. Errors are asserted by `code` (FT3). Why: a double that
    ignores `where` passes every wrong query. Check: every new route appears in an
    integration spec; Grep tests asserting `message` text → none.
A18. **Backward-compatible contract.** Contract changes are additive or versioned. A
    hardened endpoint keeps accepting (and ignoring, with a cap) what published clients
    still send, and answers with codes old clients already handle; a new required request
    field ships API-first. When a change affects the contract, the commit body states the
    deploy order (API before clients, G7). A generated API spec or client, when the
    project has one, is regenerated and committed in the same change. Why: clients and
    API are never deployed at the same instant. Check: diff of the API spec; commit body
    names the deploy order when request/response shapes changed.
A19. **Tooling green with a coverage gate.** `{{commands.api.lint}}`,
    `{{commands.api.typecheck}}`, `{{commands.api.test}}`, the integration suite and
    `{{commands.api.build}}` exit 0 (G10). The G2 coverage gate covers the API's core and
    modules (generated code, module wiring and DTO declarations excluded), enforced by the
    runner config so CI fails below it. Why: a gate in config cannot be
    forgotten. Check: run each command and read its exit code; the thresholds live in the
    runner config.
<!-- /kit:block api-common -->
