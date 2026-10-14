# Testing (A17, A19, AN13, AN14)

Two suites, two configs: unit (fast, hand-written stubs, coverage gate) and integration
(the whole app over HTTP against real Postgres). Vitest by default; Jest only when the
project already uses it.

## 1. Unit config

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    env: { TZ: 'UTC' }, // date math never depends on the machine
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/core/**/*.ts', 'src/modules/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.module.ts', 'src/**/*.controller.ts', 'src/**/dto/**', 'src/generated/**'],
      thresholds: { lines: 90, branches: 90 }, // the project's coverage gate
    },
  },
  resolve: {
    // NodeNext sources import './x.js'; Vite must resolve it to './x.ts'.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }],
  },
});
```

## 2. Service specs with hand-written stubs

```ts
// modules/orders/__tests__/orders.service.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from '../orders.service.js';

function makePrisma() {
  const prisma = {
    order: { findFirst: vi.fn(), update: vi.fn() },
    stock: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

describe('OrdersService.pay', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let queue: { add: ReturnType<typeof vi.fn> };
  let service: OrdersService;

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    prisma = makePrisma();
    queue = { add: vi.fn() };
    service = new OrdersService(prisma as never, queue as never);
  });

  it('refuses to pay an order twice with its catalog code', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'ord-1', status: 'PAID' });
    await expect(service.pay(USER_A, 'ord-1')).rejects.toMatchObject({ code: 'orders.already_paid' });
    expect(queue.add).not.toHaveBeenCalled(); // no side effect for a rejected payment
  });

  it('scopes the lookup to the caller (ownership in the where)', async () => {
    prisma.order.findFirst.mockResolvedValue(null);
    await expect(service.pay(USER_A, 'ord-1')).rejects.toMatchObject({ code: 'orders.not_found' });
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ord-1', ownerId: USER_A.id } }),
    );
  });
});
```

- No `@nestjs/testing` for service specs; no controller specs.
- Fixtures use a unique value per field (two users with different ids, names, e-mails),
  so a test cannot pass by coincidence.
- A stub proves the service ASKED for the right filter; only the integration suite proves
  the database APPLIED it.
- Errors are asserted by `code`, never by message and never with a bare
  `rejects.toThrow()` (which also accepts a `TypeError`).

## 3. Integration config and harness

```ts
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const { default: swc } = await import('unplugin-swc'); // esbuild emits no decorator metadata
  return {
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: {
      environment: 'node',
      include: ['test/integration/**/*.int-spec.ts'],
      globalSetup: ['test/integration/global-setup.ts'],
      env: { TZ: 'UTC' },
      fileParallelism: false, // files share Redis, storage and the in-memory throttler
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
    resolve: { alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }] },
  };
});
```

Global setup — option A, Testcontainers:

```ts
// test/integration/global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { spawnSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext { db: { ownerUrl: string; shadowUrl: string } }
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const ownerUrl = container.getConnectionUri();
  const shadowUrl = ownerUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1'); // scratch DB for migrate diff
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: ownerUrl },
  });
  if (migrate.status !== 0) throw new Error(`migrate deploy failed:\n${migrate.stdout}${migrate.stderr}`);
  await seedDatabase(ownerUrl); // the real seed
  project.provide('db', { ownerUrl, shadowUrl });
  return async () => container.stop();
}
```

Option B, no Docker API access: create a throwaway database on the compose Postgres
(`CREATE DATABASE "<app>_test_<random>"` through an admin connection), migrate and seed
it the same way, and `DROP DATABASE … WITH (FORCE)` in the teardown. Never point tests at
the development database.

```ts
// test/integration/support/app.ts
export async function createTestApp(): Promise<NestExpressApplication> {
  process.env.DATABASE_URL = inject('db').ownerUrl;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureApp(app); // the SAME pipeline as main.ts
  await app.init();
  return app;
}
```

## 4. Integration specs

```ts
// test/integration/orders.int-spec.ts
describe('POST /api/v1/orders', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('creates an order and returns only the allowlisted fields', async () => {
    const res = await http.post('/api/v1/orders').set(auth(USER_A)).send(validOrder());
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id', 'items', 'status', 'total']);
  });

  it('rejects a body with an unknown key (the base body passes first)', async () => {
    expect((await http.post('/api/v1/orders').set(auth(USER_A)).send(validOrder())).status).toBe(201);
    const res = await http.post('/api/v1/orders').set(auth(USER_A)).send({ ...validOrder(), total: '0.01' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'common.validation_failed' });
  });

  it("answers 404 for another user's order, on read and on write", async () => {
    const order = await createOrderFor(USER_B);
    expect((await http.get(`/api/v1/orders/${order.id}`).set(auth(USER_A))).body).toMatchObject({ code: 'orders.not_found' });
    expect((await http.post(`/api/v1/orders/${order.id}/pay`).set(auth(USER_A))).status).toBe(404);
  });

  it('lets exactly one of two concurrent payments through', async () => {
    const order = await createOrderFor(USER_A);
    const [a, b] = await Promise.all([
      http.post(`/api/v1/orders/${order.id}/pay`).set(auth(USER_A)),
      http.post(`/api/v1/orders/${order.id}/pay`).set(auth(USER_A)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('returns the request id in the header and the error envelope', async () => {
    const res = await http.get('/api/v1/orders/not-a-uuid').set(auth(USER_A)).set('X-Request-Id', 'req-12345678');
    expect(res.headers['x-request-id']).toBe('req-12345678');
    expect(res.body.requestId).toBe('req-12345678');
  });
});
```

The integration suite also holds the drift test (`migrations.md` §5) and the
route-marker test (`access-and-security.md` §3).

## 5. Mutation check

A test is only worth something if it fails when the rule breaks. For each new or changed
rule, run an in-memory mutant (a Vitest transform plugin that rewrites one snippet of one
file while the spec runs; the source file is never touched) and confirm a test fails on
an assertion. The `kit-nestjs:api-builder` agent's step 8 has the ready-to-use config and
commands. Typical API mutants:

| Rule | Mutant | Test that must kill it |
|---|---|---|
| quota check | `lte: LIMIT - quantity` → `lt: LIMIT - quantity` | last allowed unit succeeds |
| ownership | drop `ownerId: user.id` from the `where` | foreign id → 404 (integration) |
| already-paid guard | delete the `if (current.status === 'PAID')` line | second payment → 409 |
| DTO cap | `.max(LIMITS.name)` → `.max(LIMITS.name + 1)` | first failing value → 400 |
| allowlist | `select: orderSelect` → no select | response keys equal the allowlist |
| side effect after commit | move `queue.add` inside the transaction | rejected payment enqueues nothing |
