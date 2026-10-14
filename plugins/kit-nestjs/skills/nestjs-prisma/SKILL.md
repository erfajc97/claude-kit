---
name: nestjs-prisma
description: Patterns and code templates for NestJS + Prisma APIs that follow the kit's A (any backend) and AN (NestJS + Prisma) rules — module layout, error catalog with AppHttpException and one global filter, strict DTOs with nestjs-zod (or class-validator), PrismaService with explicit select, transactions, row locks and atomic counters, PATCH merge, hand-written migrations with prisma migrate diff and a drift test, default-deny guards with a route-marker test, BullMQ jobs, StorageService uploads, third-party adapters with timeouts, and Vitest unit plus real-Postgres integration tests. Use when creating or changing NestJS modules, controllers, services, DTOs, Prisma schema or migrations, jobs, uploads, error codes or backend tests.
---

# NestJS + Prisma patterns

The project's `CLAUDE.md` holds the rules (`A1…A19`, `AN1…AN14`); this skill holds the
how. Read the rule, then the reference that implements it. Code here is a template:
adapt names to the project, keep the shape.

## Map: rule → reference

| Need | Rules | Reference |
|---|---|---|
| Module layout, controller/service/repository split | A1, AN1 | this file, §1 |
| Error catalog, `AppHttpException`, global filter, envelope | A7, AN3 | `references/errors-and-dtos.md` |
| DTOs (nestjs-zod or class-validator), limits, pagination, twins | A3, G12, AN2 | `references/errors-and-dtos.md` |
| `PrismaService`, `select`, N+1, transactions, locks, PATCH merge, Decimal | A4–A6, AN4–AN7, AN9 | `references/prisma.md` |
| Migrations, `prisma.config.ts`, drift test | A11, AN8 | `references/migrations.md` |
| Bootstrap hardening, env schema, guards, route markers, throttling, request id, logs | A8, A12, A14, A15, AN10 | `references/access-and-security.md` |
| BullMQ jobs, storage uploads, third-party adapters with timeouts | A9, A10, A13, AN11, AN12 | `references/jobs-and-storage.md` |
| Unit stubs, integration on real Postgres, coverage, mutation | A17, A19, AN13, AN14 | `references/testing.md` |

## 1. Module layout

```
src/
  main.ts                       NestFactory + configureApp(app) + listen
  app.module.ts                 imports CoreModule + every domain module; APP_GUARD/APP_FILTER/APP_PIPE
  worker.ts  worker.module.ts   BullMQ processors only (separate process)
  core/
    config/       env.schema.ts (zod, fail-closed), app-config.service.ts
    database/     prisma.service.ts, advisory-lock.ts, prisma-errors.ts
    errors/       app-http.exception.ts, app-exception.filter.ts
    auth/         guards/, decorators/ (access markers), route-markers.ts
    http/         configure-app.ts, pagination.ts, patch-merge.ts, request-id.ts
    queue/        queues.ts (names + typed payloads), queue-producer.service.ts
    storage/      storage.service.ts, object-key.ts, magic-bytes.ts
    observability/ logger options, error reporter (adapters only import SDKs)
  modules/<domain>/
    <domain>.module.ts
    <domain>.controller.ts      HTTP only: DTO in, access marker, call service, DTO out
    <domain>.service.ts         rules, transactions, ownership filters
    <domain>.repository.ts      only when queries are non-trivial
    dto/                        create-<x>.dto.ts, update-<x>.dto.ts, <x>-response.dto.ts, list-<x>-query.dto.ts
    jobs/                       @Processor classes (registered in worker.module.ts only)
    helpers/                    pure functions
    __tests__/                  <domain>.service.spec.ts, helpers specs
test/integration/<domain>.int-spec.ts
prisma/schema.prisma  prisma/migrations/  prisma/seed.ts  prisma.config.ts
```

- `core/` never imports `modules/`. A module never imports another module's repository;
  it imports the other module (its exported service) or the logic moves to `core/`.
- Native ESM with `"module": "NodeNext"`: relative imports end in `.js`
  (`import { X } from './x.service.js'`), and the Prisma generator emits `.js` imports
  (see `references/migrations.md`).
- NestJS DI needs value imports: `import type` of an injected class or a DTO breaks DI
  or validation. Keep `@typescript-eslint/consistent-type-imports` off for the API.

### Controller (thin)

```ts
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequirePermission('orders:create')
  @HttpCode(201)
  create(@CurrentUser() user: SessionUser, @Body() dto: CreateOrderDto): Promise<OrderResponse> {
    return this.orders.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('orders:read')
  findOne(@CurrentUser() user: SessionUser, @Param() params: IdParamDto): Promise<OrderResponse> {
    return this.orders.findOne(user, params.id);
  }
}
```

No `PrismaService`, no `$transaction`, no `if` on business state in a controller.

## 2. New endpoint workflow

1. Contract: route, request DTO, response DTO, error codes — from the requirement or API
   spec. Missing or wrong → stop and report.
2. Error codes: add keys to the catalog + copy in every locale (`errors-and-dtos.md`).
3. DTO schemas with shared limits; response DTO as an allowlist.
4. Integration spec first (happy, validation with a passing base body, access denial,
   404 missing/foreign, tenancy/money cases when those addons are on) → red.
5. Service unit spec with hand-written stubs → red.
6. Service, then controller, then module wiring → green.
7. Data model change → migration flow (`migrations.md`) + drift test.
8. Mutation check of every new rule (`testing.md` §5).
9. Lint, typecheck, unit, integration, build → exit 0.

## 3. Common mistakes (symptom → rule → fix)

1. **A new field "does not save"** (compiles, request passes, the row stays the same) →
   AN7 → add it to the `data` of every create/update that writes the model; add a
   read-back test.
2. **A PATCH with an explicit `null` wipes data or persists an invalid combination** →
   A4/AN7 → validate the merged state (`{ ...stored, ...dto }`) and write explicit values;
   never `data: { ...dto }`.
3. **A list endpoint returns every tenant's/owner's rows** → AN7 → an optional DTO field
   reached the `where` as `undefined` and Prisma dropped the condition; build ownership
   filters from required values.
4. **`toFixed is not a function` / `NaN` on amounts** → AN9 → Prisma `Decimal` is a string
   in JSON; use the decimal helper, never float arithmetic on money.
5. **The front cannot tell errors apart** → A7/AN3 → it matches `message`; throw
   `AppHttpException('KEY')` and let clients branch on `code`.
6. **`prisma migrate dev` hangs or proposes dropping indexes** → AN8 → never use it;
   `migrate diff` → hand-edited SQL → `migrate deploy` → `generate`.
7. **Service specs are slow and brittle with `Test.createTestingModule`** → AN13 →
   instantiate the service directly with hand-written stubs.
8. **A stub-based test passes but production returns other users' rows** → AN14 → data
   rules (where, unique, locks) are proven against real Postgres.
9. **The total comes from the request body** → A4 → clients send ids and quantities;
   prices, totals and fees are computed server-side from the database.
10. **Two concurrent requests both pass a limit check** → AN6 → conditional update with a
    `count` check, or a row/advisory lock as the first statement of the transaction.
11. **A worker idles in a Redis reconnect loop and burns paid egress** → AN11 →
    connections are lazy and bounded; nothing connects at import time.
12. **Integration tests fail with `undefined` constructor params** → AN14 → esbuild emits
    no decorator metadata; the integration Vitest config uses `unplugin-swc`.
13. **An e-mail is sent for an order that rolled back** → AN5 → side effects run after
    the transaction commits.
14. **A new static route returns the `:id` handler** → AN10 → declare static routes
    before parameterized ones and verify against the running router.
15. **`P2028` 500s under load** → `references/prisma.md` §4 → set transaction
    `maxWait`/`timeout` once in `PrismaService` and map `P2028` to a retryable 503 code.

## 4. Checklist before reporting done

- [ ] Every acceptance criterion has a test that was seen red, now green.
- [ ] Service specs use hand-written stubs; data rules have integration tests on real Postgres.
- [ ] Every business error is `AppHttpException('KEY')` with catalog key, copy in every locale, and a test asserting `code`.
- [ ] New fields appear in every create/update `data`; PATCH validates the merged state; no `undefined` in a `where`.
- [ ] Every query leaving a service has `select`; responses are DTO allowlists.
- [ ] Multi-table writes in `$transaction`; side effects after commit; counters/limits atomic.
- [ ] Schema changes shipped as hand-checked migrations; drift test green; no `migrate dev`/`db push`.
- [ ] New routes carry exactly one access marker; the route-marker test is green.
- [ ] Heavy work queued with deterministic `jobId`; connections lazy.
- [ ] New env vars in the schema, `.env.example` and docs.
- [ ] Mutation check: every new rule killed by a test.
- [ ] Lint, typecheck, unit (coverage gate), integration, build: exit 0.
