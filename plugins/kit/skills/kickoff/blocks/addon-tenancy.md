<!-- kit:block addon-tenancy v1 -->
## Rules — Multi-tenancy (`T`)

The tenant is the organization (key `organizationId` / `organization_id` unless a `P` rule
names another). A leak between tenants is always a BLOCKER. Base rules this block builds on
instead of repeating: the 404 envelope (A7), default-deny route markers (A14, AN10), private
storage keys (A13, AN12) and `undefined` dropped from a `where` (AN7).

T1. **Every business row belongs to a tenant.** Every business table has the tenant key
    (NOT NULL, indexed) and every query on it filters by the tenant in the service or
    repository — the first barrier. Where the database supports it, row-level security keyed
    by a per-transaction setting is the second barrier, added in the same migration that
    creates the table. Why: one missing `where` exposes every customer. Check: Grep touched
    data-access files for `find(Unique|First|Many)\(\s*\{\s*where:\s*\{\s*id` and
    `(update|delete)(Many)?\(\s*\{\s*where:\s*\{\s*id` without the tenant key on the same
    call; every new table's migration contains its policy (`CREATE POLICY` / `ENABLE ROW
    LEVEL SECURITY`) or a `P` rule says why not.

T2. **The other-tenant test, per module.** Another tenant's resource answers exactly like a
    missing one (404 with the resource's code, A7). Every module ships an integration test
    that creates two tenants with different data (FT5) and tries to read, update, delete,
    list, search and export the other tenant's resource → 404 (FT11); the tenant filter is
    a mutation target of G3. Why: a 403 confirms the id exists, and only this test proves
    the filter. Check: Grep each touched module's integration spec for the other-tenant
    case.

T3. **The tenant comes from the session.** The active tenant is resolved per request from
    the authenticated session (a header that selects among the user's tenants is checked
    against membership); a tenant id in a body or query is never trusted. Services receive a
    request context (`ctx.orgId`, `ctx.userId`, `ctx.role`), not loose ids. Why: a forged
    id would otherwise pick the tenant. Check: Grep DTOs for `organizationId|orgId|tenantId`
    as an input field → finding unless a `P` rule allows it (e.g. a platform backoffice).

T4. **No role escalation.** The permission matrix lives in ONE shared module (route markers
    themselves: A14, AN10). Nobody can grant, invite or promote above their own role, and a
    user can never change their own role or permissions; changing the last owner is
    refused. Why: an admin who makes themselves owner owns the tenant. Check: one test per
    escalation path (invite with a higher role, self-promotion, demoting the last owner)
    expects the error code.

T5. **Scope contracts.** Tenant-scoped data access takes a typed scope (a branded type that
    only the request context or a named system scope — `fromSystem(orgId, 'reason')` —
    can create); casting into it is a lint error. Access that bypasses tenant isolation
    (`asSystem('reason', fn)`) is allowed only from files listed in one allowlist file, each
    with a snake_case reason. Background jobs carry the tenant explicitly in their payload.
    Why: the type system makes "forgot the tenant" a compile error. Check: Grep
    `as\s+(OrgScope|TenantScope)` → zero; Grep the bypass call and compare its files with
    the allowlist; Grep job payload types for the tenant key.

T6. **Cross-tenant references are rejected.** A foreign key from a tenant row to another
    tenant table must point to a row of the SAME tenant — enforced by the database
    (composite FK or a same-tenant trigger) or, at least, by the service — and a violation
    maps to 404. Why: linking another tenant's id leaks it through joins. Check: every new
    FK column in a migration is in the guard (trigger/composite key); an integration test
    links a foreign tenant's id → 404.

T7. **Visibility in one helper.** Role visibility (own records, team, everything) is
    resolved by ONE helper (`visibilityWhere(ctx)`) used by every door: list, detail,
    search, counts, export, notifications. Why: the door that rebuilt the rule is the one
    that leaks (G12). Check: Grep touched queries for role checks written inline
    (`role ===`, `ctx.role` inside a `where`) instead of the helper.

T8. **Tenant ledgers are append-only.** Audit log, usage events and similar ledgers are
    insert-only (no update/delete in code; DB grants or triggers enforce it where possible).
    Creating, changing, deleting, exporting and viewing sensitive data is recorded in the
    same transaction, with minimal before/after and no secrets. Why: an editable audit log
    is not evidence. Check: Grep `(update|delete)(Many)?\(` on ledger models → zero; the
    sensitive action's test asserts its ledger row.

T9. **The tenant is the owner everywhere.** In storage keys (A13: `org/<orgId>/<kind>/<uuid>`),
    signed URLs, search indexes, caches, queues and exports, the owner segment is the
    tenant, and a key or entry of another tenant is 404. Tenant and visibility filters are
    built from required, validated values (AN7: an `undefined` filter returns every row).
    Why: every secondary store is another door. Check: a test signs, searches and exports
    with another tenant's key → 404; Grep cache/search keys for the tenant segment.
<!-- /kit:block addon-tenancy -->
