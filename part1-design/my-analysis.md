# My Analysis of the AI Critique

## Where I agree

The most important finding is the first one. The composite `(org_id, ...)` foreign keys make cross-tenant _writes_ impossible, but nothing in the database stops a cross-tenant _read_, and the DataLoader pattern described in the documentation (`WHERE id = ANY($1)`) was unscoped. In Part 2 every query and loader is scoped to the caller's organizations, and the tests fail when that scoping is removed.

I also agree with three findings because they were measured, not argued:

- **Unindexed foreign keys to `users`.** Deleting one user took 4.1 s at 100x volume, inside a single transaction. The fix is four indexes.
- **The summary query scans the whole project.** 4.5 ms at 2,500 tasks became 624 ms at 250,000.
- **Activity history is deleted with its task.** `task_activity` cascades from `tasks`. For an audit trail that is simply the wrong default.

## Where I disagree

**Severity of the N+1 finding (#3).** Batching paginated children per parent with `LATERAL` is the right technique, but the simpler fix is not to expose nested paginated connections inside list contexts at all. I would rate this Medium and fix it in schema design, not clever resolvers.

**Triggers for activity history (#4).** A trigger guarantees that a row gets written, but it gets the actor from `SET LOCAL app.user_id`. That is fragile behind a transaction-pooling proxy, and it records _that_ a column changed, not _why_. I would keep the write explicit, in the same transaction as the update (the CTE pattern in the documentation), routed through one service function. A trigger is a safety net for writes that bypass that function, not the primary mechanism.

**Row-Level Security as the fix for #1.** I want RLS eventually, but not first: it adds per-transaction session state and fails silently if the setting is missing. The first fix is one data-access path that requires org IDs, plus a test per entry point that requests another tenant's ID. RLS comes after that.

**Partitioning `task_activity` and UUIDv7 (#12, #16).** Both are premature. At 100x the activity table is still a few gigabytes, and `(task_id, id)` serves the access pattern. I would partition when there is a retention policy to enforce, not before.

## What the critique missed

- **Archived projects are inconsistent.** `projects` hides archived projects, but `tasks(projectId)` still serves them. The schema has `archived_at` with no defined meaning for reads.
- **Organization deletion.** Every tenant table cascades from `organizations`, so deleting a large customer is one enormous transaction holding locks across every table. Offboarding needs soft deletion and a batched purge. It also needs an export path, which customers will ask for before they leave.
- **User deletion loses attribution.** `ON DELETE SET NULL` on `author_id` and `actor_id` keeps the rows but erases who did what. That conflicts with the purpose of an audit log, and it needs an explicit policy (pseudonymise, don't null).
- **No `statement_timeout` or per-tenant limits.** A 624 ms summary on a pooled connection is a noisy-neighbour problem once several large tenants load boards at the same time.
- **The test environment did not match the target.** The critique noticed PostgreSQL 18's skip scan hiding a slow plan, but the broader lesson is process: performance claims must be verified on the production version, so CI needs PostgreSQL 16.
- **The sort order is not the one users want.** Users sort by due date or priority, and a keyset over a nullable `due_date` needs explicit `NULLS LAST` handling and a different cursor.

## What I would fix first and why

I would order the work by how reversible the harm is, then by cost.

1. **Tenant scoping on reads.** A data leak cannot be undone and ends customer trust. The cost is low: one data-access path and a test per entry point. Part 2 already does this for the board.
2. **Stop deleting history.** Soft-delete tasks and drop the cascade from `task_activity`. Every day this is not fixed, audit data is permanently lost.
3. **Index the four foreign keys to `users`.** Ten minutes of work removes multi-second locks.
4. **Summary cost for large projects.** A covering index plus a short-lived cache, as planned in the RFC. This matters only for the largest tenants, so it follows the correctness work.

Partitioning, UUIDv7 and typed settings wait until measurements show they are needed.
