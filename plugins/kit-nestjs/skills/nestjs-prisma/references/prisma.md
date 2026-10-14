# Prisma in NestJS (A4–A6, AN4–AN7, AN9)

## 1. `PrismaService`

The only database client of the app. Prisma 7 uses a driver adapter and a generated
client output path; Prisma 5/6 projects import `PrismaClient` from `@prisma/client` and
skip the adapter.

```ts
// core/database/prisma.service.ts
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Bounds of EVERY transaction, set once. Prisma's defaults (maxWait 2 s, timeout 5 s) turn
 * slow-but-healthy requests into 500s under CPU pressure; blowing these is P2028, mapped to a
 * retryable 503 code by the global filter. A deadlock (P2034) stays a logged 500: it is a
 * lock-ordering bug.
 */
export const TRANSACTION_DEFAULTS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        // Longer than maxWait so a busy pool surfaces as Prisma's typed P2028, not a raw pg error.
        connectionTimeoutMillis: TRANSACTION_DEFAULTS.maxWait + 5_000,
        idleTimeoutMillis: 30_000,
      }),
      transactionOptions: TRANSACTION_DEFAULTS,
    });
  }

  // Connection is lazy (first query): scripts that build the app without a database still work.
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
```

`DatabaseModule` provides and exports it; nothing else constructs a client (lint, AN4).

## 2. Explicit `select` and typed payloads

```ts
// modules/orders/orders.select.ts
import type { Prisma } from '../../generated/prisma/client.js';

export const orderSelect = {
  id: true,
  status: true,
  total: true,
  createdAt: true,
  items: { select: { productId: true, quantity: true, unitPrice: true } },
} satisfies Prisma.OrderSelect;

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export function toOrderResponse(row: OrderRow): OrderResponse {
  return {
    id: row.id,
    status: row.status,
    total: row.total.toFixed(2), // Decimal → decimal string (A6)
    createdAt: row.createdAt.toISOString(),
    items: row.items.map((item) => ({ ...item, unitPrice: item.unitPrice.toFixed(2) })),
  };
}
```

Every read that leaves the service uses a `select` object like this; a new column is
exposed only by adding it here on purpose.

## 3. Lists without N+1

```ts
async list(user: SessionUser, query: ListOrdersQueryDto): Promise<Paginated<OrderResponse>> {
  const where = { ownerId: user.id, ...(query.q ? { reference: { contains: query.q, mode: 'insensitive' as const } } : {}) };
  const [rows, total] = await this.prisma.$transaction([
    this.prisma.order.findMany({
      where,
      select: orderSelect,
      orderBy: [{ [query.sort]: query.order }, { id: 'asc' }], // unique tiebreaker: stable pages
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    this.prisma.order.count({ where }),
  ]);
  return { items: rows.map(toOrderResponse), total, page: query.page, limit: query.limit };
}
```

- The array form of `$transaction([...])` is a batch: fine. `Promise.all` over an
  interactive `tx` is not (AN5).
- Related data comes from a nested `select` or one `findMany({ where: { id: { in: ids } } })`,
  never a query inside a loop.
- Every column in `where` and `orderBy` has an index in the migration (A11).

## 4. Transactions and side effects after commit

```ts
async pay(user: SessionUser, orderId: string): Promise<OrderResponse> {
  const order = await this.prisma.$transaction(async (tx) => {
    const current = await tx.order.findFirst({
      where: { id: orderId, ownerId: user.id },
      select: { id: true, status: true },
    });
    if (!current) throw new AppHttpException('ORDER_NOT_FOUND');
    if (current.status === 'PAID') throw new AppHttpException('ORDER_ALREADY_PAID');

    await this.stock.reserveFor(tx, orderId); // helpers receive tx explicitly
    return tx.order.update({ where: { id: orderId }, data: { status: 'PAID' }, select: orderSelect });
  });

  // Side effects only after the commit: a rollback must not send e-mails or enqueue jobs.
  await this.queue.add('order-paid', { orderId }, { jobId: `order-paid:${orderId}` });
  return toOrderResponse(order);
}
```

Inside the callback: statements awaited one by one, decisions read through `tx`, no
try/catch that swallows a failed statement (PostgreSQL has already aborted the
transaction; the next statement fails with 25P02).

## 5. Concurrency: atomic counters and locks

Conditional update (preferred for counters and quotas):

```ts
const { count } = await tx.quota.updateMany({
  where: { ownerId, used: { lte: LIMIT - quantity } },
  data: { used: { increment: quantity } },
});
if (count !== 1) throw new AppHttpException('QUOTA_EXCEEDED');
```

Row lock with a tagged raw query (parameters are bound, never interpolated):

```ts
const [row] = await tx.$queryRaw<{ id: string; stock: number }[]>`
  SELECT id, stock FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
```

Advisory lock for check-then-insert ("one live row per X"), as the FIRST statement:

```ts
// core/database/advisory-lock.ts
export async function lockForTransaction(tx: TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
```

Take several locks in one global order (sort the keys). Unique violations:

```ts
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.name === 'PrismaClientKnownRequestError'
    && (error as Error & { code?: unknown }).code === 'P2002';
}

try {
  return await this.prisma.invite.create({ data, select: inviteSelect });
} catch (error) {
  if (!isUniqueViolation(error)) throw error;
  // A lost race only if the winner's row really exists; otherwise it is a bug: rethrow.
  const winner = await this.prisma.invite.findUnique({ where: { email_teamId: { email, teamId } }, select: inviteSelect });
  if (!winner) throw error;
  return winner;
}
```

Prove it with an integration test that fires two requests with `Promise.all` and expects
one success and one catalog code.

## 6. Create/update traps and PATCH

```ts
// core/http/patch-merge.ts
/** `undefined` (not sent) keeps the stored value; anything else, null included, replaces it. */
export function keepUnlessSent<T>(sent: T | undefined, stored: T): T {
  return sent === undefined ? stored : sent;
}
```

```ts
async update(user: SessionUser, id: string, dto: UpdateProductDto): Promise<ProductResponse> {
  const stored = await this.prisma.product.findFirst({
    where: { id, ownerId: user.id },
    select: { kind: true, price: true, stock: true, discontinuedAt: true },
  });
  if (!stored) throw new AppHttpException('PRODUCT_NOT_FOUND');

  const merged = {
    kind: keepUnlessSent(dto.kind, stored.kind),
    price: keepUnlessSent(dto.price, stored.price.toFixed(2)),
    stock: keepUnlessSent(dto.stock, stored.stock),
  };
  assertProductRules(merged); // rules run on the MERGED state, never on the patch alone

  const row = await this.prisma.product.update({
    where: { id },
    data: { kind: merged.kind, price: merged.price, stock: merged.stock }, // explicit, never { ...dto }
    select: productSelect,
  });
  return toProductResponse(row);
}
```

- A new column must appear in every `create`, `update`, `upsert` and `createMany` of the
  model; a test reads it back after each.
- `undefined` in a `where` removes the condition:

```ts
// BUG: dto.ownerId is optional → { ownerId: undefined } → every row matches.
this.prisma.order.findMany({ where: { ownerId: dto.ownerId } });
// FIX: ownership comes from the session, a required value.
this.prisma.order.findMany({ where: { ownerId: user.id } });
```

- Replace-all writes (`deleteMany` + `createMany`) reject an empty list unless emptying
  is the intended action; the form says why it cannot be empty.

## 7. Money and time (AN9)

```prisma
model Order {
  id        String   @id @default(uuid()) @db.Uuid
  total     Decimal  @db.Decimal(14, 2)
  currency  String   @db.Char(3)
  dueDate   DateTime @db.Date
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  ownerId   String   @db.Uuid
  owner     User     @relation(fields: [ownerId], references: [id], onDelete: Restrict)

  @@index([ownerId, createdAt])
}
```

```ts
// shared/decimal.ts — one helper, one rounding rule
import { Prisma } from '../generated/prisma/client.js';
const D = Prisma.Decimal;

export function sum(values: readonly (string | Prisma.Decimal)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(new D(v)), new D(0));
}

/** Round once, at the end, half-up to cents. */
export function toCents(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}
```

Never `Number(amount)` for arithmetic, never `Float` columns for money. Payments,
idempotency keys and money locks follow `addon-money` when the project enables it.

## 8. Repository (only when queries are non-trivial)

```ts
@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Data access only: returns rows, never throws HTTP errors (A1). */
  findOwned(tx: TransactionClient | PrismaService, ownerId: string, id: string): Promise<OrderRow | null> {
    return tx.order.findFirst({ where: { id, ownerId }, select: orderSelect });
  }
}
```

The service decides what a missing row means (`AppHttpException('ORDER_NOT_FOUND')`).
