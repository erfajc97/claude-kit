# Migrations (A11, AN8)

## 1. Never `migrate dev`, never `db push`

`prisma migrate dev` waits for interactive input (it hangs in agents and CI) and, on a
schema that does not declare everything the SQL created, proposes destructive changes:
dropping partial indexes, CHECK constraints or time zones that exist only in migrations.
`prisma db push` skips migrations entirely. Both are forbidden in scripts, docs and
commands.

## 2. Configuration

```ts
// prisma.config.ts (Prisma 7)
import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL, // scratch DB for `migrate diff --from-migrations`
  },
});
```

```prisma
// prisma/schema.prisma (Prisma 7, native ESM API)
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"   // NodeNext: relative imports of the generated client need .js
}

datasource db {
  provider = "postgresql"
}
```

Package scripts (names are the project's choice; these are the commands behind them):

```json
{
  "db:diff": "prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script",
  "db:migrate": "prisma migrate deploy",
  "db:generate": "prisma generate",
  "db:seed": "tsx prisma/seed.ts"
}
```

## 3. The flow

1. Edit `prisma/schema.prisma` (types: `Decimal @db.Decimal(p, s)` for money,
   `@db.Timestamptz(3)` for instants, `@db.Date` for dates, explicit `onDelete`,
   `@@index` for every filter/sort column).
2. Generate the SQL of the change:
   `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
3. Save it as `prisma/migrations/<YYYYMMDDHHmmss>_<snake_name>/migration.sql`. The
   timestamp is the real current UTC time and sorts after the last migration. First line:
   a comment saying WHY.
4. Edit by hand what Prisma cannot express, and document each item with `///` on its
   model so nobody "fixes" it away:

   ```sql
   -- Why: an order can only be paid once per idempotency key; amounts are never negative.
   ALTER TABLE "orders" ADD CONSTRAINT "orders_total_non_negative" CHECK ("total" >= 0);
   CREATE UNIQUE INDEX "orders_one_open_per_cart_idx" ON "orders" ("cart_id") WHERE "status" = 'OPEN';
   ```

   ```prisma
   /// orders_one_open_per_cart_idx (partial unique, migration 20260101120000_open_orders):
   /// at most one OPEN order per cart. Lives only in SQL; never drop it.
   model Order { … }
   ```

5. Apply and regenerate: `prisma migrate deploy && prisma generate` (and rebuild a db
   package consumed from `dist`, or the API rejects new fields with "Unknown argument").
6. Run the drift test (§5) and the integration suite.

## 4. Additive changes (expand → backfill → contract)

- Add a column nullable (or with a default), deploy, backfill with a script verified
  against the real helper, then add `NOT NULL` in a later migration.
- Renames are add-new + copy + switch reads + drop-old, across deploys, so the running
  version never sees its column disappear.
- Splitting one row into several: re-check every unique index that covered the old row.
- Once a migration has been applied to any shared database it is frozen: never edit,
  rename or reorder it; every change is a new migration.

## 5. Drift test

Hand-edited migrations are only safe if a test proves they build exactly the schema the
client is generated from:

```ts
// test/integration/drift.int-spec.ts
import { spawnSync } from 'node:child_process';
import { inject } from 'vitest';

it('replaying every migration yields exactly schema.prisma', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'diff',
      '--from-migrations', 'prisma/migrations',
      '--to-schema', 'prisma/schema.prisma',
      '--exit-code'],
    {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: inject('db').ownerUrl, SHADOW_DATABASE_URL: inject('db').shadowUrl },
    },
  );
  // --exit-code: 0 = identical, 2 = drift, 1 = error
  expect(result.stdout + result.stderr).toContain('No difference detected');
  expect(result.status).toBe(0);
});
```

The diff does not see everything (some CHECKs, triggers, enum value additions): review
those by hand in the migration and cover them with an integration test that hits the
constraint (insert the invalid row, expect the catalog code).

## 6. Seeds

`prisma/seed.ts` is idempotent (`upsert` by natural key), creates only development
data, refuses to run against production (`NODE_ENV` check plus a non-local host check),
and never prints generated credentials: it writes them to a git-ignored file if needed.
