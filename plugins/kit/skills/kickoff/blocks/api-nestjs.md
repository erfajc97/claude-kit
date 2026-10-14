<!-- kit:block api-nestjs v1 -->
## Rules — NestJS + Prisma (`AN`)

AN1. **Module layout; `core` never imports a module.** `{{scopes.api.path}}` follows:
    ```
    src/
      main.ts  app.module.ts          (worker.ts  worker.module.ts when there are jobs)
      core/                           config/ database/ errors/ auth/ http/ queue/ storage/ observability/
      modules/<domain>/
        <domain>.module.ts  <domain>.controller.ts  <domain>.service.ts
        <domain>.repository.ts        (only for non-trivial queries)
        dto/  jobs/  helpers/  __tests__/
    test/integration/<domain>.int-spec.ts
    prisma/schema.prisma  prisma/migrations/  prisma/seed.ts
    ```
    Controllers are thin: no `PrismaService`, no transactions, no business branching.
    Why: the layout is what A1 means in Nest terms. Check: Grep
    `from ['"](\.\./)+modules/` in `src/core` → none; Grep `PrismaService|\$transaction`
    in `*.controller.ts` → none.
AN2. **DTOs with `{{scopes.api.validator}}`.** Default nestjs-zod: `class CreateXDto
    extends createZodDto(createXSchema) {}` with `.strict()` schemas whose caps come from
    the shared limits module (shared with the front-end when both validate the field),
    and a global `ZodValidationPipe` (`APP_PIPE`). Projects that already use
    class-validator keep it: global `ValidationPipe({ whitelist: true,
    forbidNonWhitelisted: true, transform: true })`, every body and query is a class from
    a `*.dto.ts` imported as a VALUE (an `import type` erases the class and silently
    disables validation), nested objects use `@ValidateNested()` + `@Type()`, every string
    has `@MaxLength(LIMIT)`, arrays `@ArrayMaxSize`, numbers `@Min`/`@Max`, and body
    booleans/numbers are not implicitly converted. Never `@Body() body: any`,
    `@Body('field')`, `@Query('field')` or inline object types. Why: the pipe only
    validates what it can see as a DTO class. Check: Grep in `*.controller.ts`
    `@Body\(\)\s+\w+:\s*(any|Record|\{)|@Body\(['"]|@Query\(['"]|import type .*Dto` → none.
AN3. **`AppHttpException` and one global filter.** Business errors are
    `throw new AppHttpException('KEY', details?)` with `KEY` from the error catalog; never
    `new BadRequestException('text')` and friends (lint `no-restricted-syntax` on
    `NewExpression[callee.name=/^(BadRequest|NotFound|Forbidden|Unauthorized|Conflict)Exception$/]`).
    One `@Catch()` filter (`APP_FILTER`) maps `AppHttpException`, framework
    `HttpException`, validation errors, Prisma known errors (detected by `name` + `code`:
    `P2002` → conflict code, `P2025` → not-found code, `P2000` → validation code) and
    unknown errors (500, logged once, reported) into the A7 envelope with `requestId`.
    Why: one place decides status, code and redaction. Check: the lint rule is configured;
    Grep `new (BadRequest|NotFound|Forbidden|Unauthorized|Conflict|InternalServerError)Exception\(`
    in `src/` outside specs → none.
AN4. **`PrismaService` with explicit `select`.** App code injects `PrismaService`;
    `new PrismaClient()` exists only in seed, scripts and the test harness (lint
    `NewExpression[callee.name='PrismaClient']`). Every query whose result leaves the
    service uses `select` (no bare `include`, never `passwordHash` or tokens). Lists use
    `skip`/`take` from the pagination DTO and an `orderBy` with a unique tiebreaker
    (`[{ createdAt: 'asc' }, { id: 'asc' }]`). No queries inside loops: batch with
    `where: { id: { in: ids } }` or a nested `select`. Why: whole models leak columns and
    loops are N+1. Check: Grep `new PrismaClient\(` under `src/` → none; Grep `include:` and
    `find(Many|Unique|First)\(\{` in services and confirm a `select`; Grep multiline
    `for \([^)]*\) \{[\s\S]{0,300}?await this\.prisma` → none.
AN5. **Transactions.** Writes that touch more than one table or row set run in
    `prisma.$transaction`: interactive (`async (tx) => …`) when logic sits between
    statements; statements awaited one after another (never `Promise.all` over `tx`);
    what decides is read INSIDE the transaction; `tx` is passed explicitly to helpers; no
    try/catch that continues after a failed statement (the transaction is already
    aborted: 25P02); no external side effects inside (mail, queue jobs, analytics, HTTP):
    they run after commit. Why: half-written state and side effects of a rolled-back
    transaction are the classic data bugs. Check: Grep multiline
    `\$transaction\([\s\S]{0,1500}?(Promise\.all|sendMail|\.add\(|track\(|fetch\(|catch \()`
    and review every hit.
AN6. **Atomic counters and locks.** Counters, quotas, stock and "one live row per X" are
    protected atomically: a conditional update (`updateMany({ where: { id, used: { lte:
    limit - n } }, data: { used: { increment: n } } })` and require `count === 1`), or
    `SELECT … FOR UPDATE` / `pg_advisory_xact_lock(hashtextextended(${key}, 0))` as the
    FIRST statement of the transaction, with lock keys taken in one global order. A
    `P2002` counts as a lost race only if the winner's row exists (re-read it); otherwise
    rethrow. Raw SQL only through tagged `$queryRaw` / `$executeRaw` templates (lint bans
    `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw`). Why: check-then-write without a
    lock lets two requests pass the same check. Check: an integration test fires two
    concurrent requests and asserts one success and one catalog code; Grep
    `\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(` → none.
AN7. **Create/update traps (A4 in Prisma).** A new column appears in the `data` of every
    `create`, `update`, `upsert` and `createMany` that writes the model, with a test that
    reads it back. PATCH = `findUnique` (absent → `AppHttpException` not-found) → merge with the
    DTO → validate the merged state → `update` with explicit fields (`keepUnlessSent(dto.x,
    stored.x)`), never `data: { ...dto }`. `undefined` never reaches a `where`: Prisma
    drops the key and the filter matches every row, so ownership and visibility filters
    are built from required, validated values. Replace-all writes (`deleteMany` +
    `createMany`) reject an empty set unless emptying is the intent. Why: these compile,
    pass review and corrupt data. Check: Grep `data:\s*\{\s*\.\.\.` → none; Grep `where:`
    objects built from optional DTO fields and confirm a presence check; one persistence
    test per new column.
AN8. **Migrations by diff, never `migrate dev`.** `prisma migrate dev` and
    `prisma db push` are forbidden (they hang without a TTY and propose dropping what only
    lives in SQL). Flow: edit `schema.prisma` → `prisma migrate diff --from-migrations
    prisma/migrations --to-schema prisma/schema.prisma --script` (shadow database URL from
    env) → save as `prisma/migrations/<YYYYMMDDHHmmss>_<snake_name>/migration.sql` with a
    comment saying why → add by hand what Prisma cannot express (CHECK, partial or
    expression indexes, triggers) and document each with `///` on its model →
    `prisma migrate deploy` → `prisma generate` (then rebuild a db package consumed from
    `dist`). Datasource and shadow URLs live in `prisma.config.ts`, read from env. Why:
    A11 in Prisma terms. Check: Grep `migrate dev|db push` in package scripts, docs and
    scripts → none; the drift test (AN14) runs `prisma migrate diff --from-migrations
    prisma/migrations --to-schema prisma/schema.prisma --exit-code` and expects exit 0.
AN9. **Schema types.** Money is `Decimal @db.Decimal(p, s)`, never `Float`; Prisma
    `Decimal` serializes as a string, so code converts it with the decimal helper and never
    does `Number()` arithmetic on money. Instants are `DateTime @db.Timestamptz(3)`,
    business dates `@db.Date`. Every relation has an explicit `onDelete`; every filter or
    sort column has an `@@index`; enums that a front-end maps are compared against the
    schema enum by a test. Why: A6 and A11 enforced where the types are declared. Check:
    Grep `schema.prisma` for `\bFloat\b` → none; Grep `DateTime` lines and confirm
    `@db.Timestamptz` or `@db.Date`; Grep `@relation\(` lines and confirm `onDelete`.
AN10. **Guards default-deny, one marker per route.** Global guards via `APP_GUARD`
    (authentication → permission/role → throttler). Every handler declares exactly one
    access-marker decorator from the project's set (e.g. `@Public()`,
    `@RequirePermission('resource:action')`); an unmarked route is denied by the guard,
    and a test scans every controller (`MetadataScanner` + `Reflector` over
    `PATH_METADATA`) and fails on 0 or more than 1 marker. `@Throttle()` is stricter on
    auth, OTP, password reset and cost routes. A new static route is verified against the
    running router so an earlier `:param` route does not swallow it. Why: A14 made
    mechanical. Check: the route-marker test is green; Grep `@Public\(\)` in the diff and
    justify each hit.
AN11. **BullMQ for heavy work.** Queue names and typed payloads live in `core/queue`;
    producers go through one producer service; `@Processor` classes live in
    `modules/<domain>/jobs/` and are registered only in the worker module (separate
    `worker.ts` entry and process). Jobs are added with a deterministic `jobId`,
    `attempts` and exponential `backoff`, and `removeOnComplete` / `removeOnFail` caps; the
    last failed attempt is reported. Redis connections are lazy (`lazyConnect: true`;
    `maxRetriesPerRequest: null` for workers) and never opened at import time. Why: A10
    with BullMQ. Check: Grep `@Processor\(` outside `jobs/` → none; Grep `\.add\(` on
    queues and confirm a `jobId`; Grep module-level `new (Redis|Queue|Worker)\(` → none.
AN12. **Files only through `StorageService`.** It is the only importer of the storage
    SDK (`@aws-sdk/*`): `createUploadPost({ owner, kind, mime, size })` builds the key
    server-side and signs `content-length-range` and `Content-Type` from the allowlist;
    `createDownloadUrl({ owner, key, ttlSeconds })` with `ttlSeconds ≤ 300` and
    `attachment`; `head` / `get` / `put` / `delete` take `{ owner, key }` and a key outside
    the owner's prefix is a 404; magic bytes are verified after upload. Why: A13 in one
    place. Check: Grep `@aws-sdk/` imports outside `core/storage` → none.
AN13. **Unit tests with hand-written stubs.** Runner `{{testRunner.api}}` (Vitest; Jest
    only when the project already uses it). Services are instantiated directly:
    `new OrdersService(prisma as unknown as PrismaService)` with
    `const prisma = { order: { findUnique: vi.fn(), update: vi.fn() }, $transaction: vi.fn((fn) => fn(prisma)) }`;
    never `@nestjs/testing` for service specs, and no controller specs (integration covers
    controllers). `vitest.config.ts` pins `env: { TZ: 'UTC' }`, maps NodeNext `.js`
    imports to `.ts`, and enforces the G2 gate in `coverage.thresholds` (lines and
    branches) over `src/core` and `src/modules` (excluding `*.module.ts`,
    `*.controller.ts`, `dto/`). Why: fast, explicit tests; data rules go to AN14. Check:
    Grep `@nestjs/testing` under `src/**/__tests__` → none; the thresholds exist in the
    config; `{{commands.api.test}}` exits 0.
AN14. **Integration tests on real Postgres.** `test/integration/*.int-spec.ts` boot the
    whole app (`NestFactory.create(AppModule)` plus the same bootstrap helper `main.ts`
    uses) and call it with supertest against real Postgres: Testcontainers
    (`@testcontainers/postgresql`) or a throwaway database created in Vitest
    `globalSetup`, migrated with `prisma migrate deploy` (the real migrations), seeded
    with the real seed and dropped at teardown. A separate `vitest.integration.config.ts`
    uses `unplugin-swc` (esbuild emits no decorator metadata) and
    `fileParallelism: false` when files share Redis, storage or throttler state. Errors
    are asserted with `expect(res.body).toMatchObject({ code })`. The suite includes the
    drift test (AN8) and the route-marker test (AN10). Why: a stub cannot prove a `where`,
    a constraint or a lock. Check: the integration command exits 0 with Docker up; every
    new route appears in a spec.
<!-- /kit:block api-nestjs -->
