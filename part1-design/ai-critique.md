# Architecture Critique of the R-1.1 Schema

AI-generated critique (Claude), produced on request, of the design in [`schema.sql`](schema.sql), [`schema.graphql`](schema.graphql) and [`technical-documentation.md`](technical-documentation.md). The same AI session wrote that design, so this review deliberately looks for what the design gets wrong rather than defending it. The author's own assessment is in [`my-analysis.md`](my-analysis.md).

**Method.** Claims marked _measured_ come from `EXPLAIN (ANALYZE, BUFFERS)` on a scratch database built from `schema.sql`. Two data sets were used: "current" is one project with 2,500 tasks, and "100x" is one project with 250,000 tasks plus 250,000 activity rows. Measurements ran on local PostgreSQL 18; `docker-compose.yml` targets 16, and the one place where that matters is called out. Everything else is analysis.

**Severity scale.** _Critical_: a likely data leak or data loss in normal operation. _High_: breaks correctness or performance at expected scale. _Medium_: a real defect with limited blast radius or a clear workaround. _Low_: a quality issue worth scheduling.

## Summary

| #   | Severity | Area        | Finding                                                                                         | Location                                                                                       |
| --- | -------- | ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Critical | Security    | Reads have no database-level tenant guard; the documented DataLoader design is unscoped         | `technical-documentation.md` §3–4; `Query.task`, `Query.project`, all `Task.*` loaders         |
| 2   | High     | N+1 / cost  | Nested connections with unbounded `first` and no depth or cost limit                            | `Organization.projects` → `Project.tasks` → `Task.comments`                                    |
| 3   | High     | N+1         | Per-parent paginated children cannot be batched by a by-key DataLoader                          | `Project.tasks`, `Task.comments`, `Task.activity`                                              |
| 4   | High     | Consistency | Activity history is incomplete (app-written) and not durable (cascade-deleted)                  | `task_activity` FK `ON DELETE CASCADE`; `deleteProjectStatus`                                  |
| 5   | High     | Scalability | Summary is a full scan of the project: 4.5 ms → 624 ms at 100x (_measured_)                     | §2 summary query; no covering index on `tasks`                                                 |
| 6   | High     | Indexes     | Four foreign keys to `users` are unindexed; deleting one user took 4.1 s at 100x (_measured_)   | `projects.created_by`, `tasks.created_by`, `task_comments.author_id`, `task_activity.actor_id` |
| 7   | Medium   | Consistency | "At least one owner" is a comment, not an invariant; concurrent demotions can leave zero owners | `organization_members.role`; `updateMemberRole`, `removeMember`                                |
| 8   | Medium   | Consistency | Changing a status's category silently rewrites history; no `completed_at`                       | `project_statuses.category`; `updateProjectStatus`                                             |
| 9   | Medium   | Correctness | "Overdue" uses the database server's date, not the organization's                               | `current_date` in §2 queries; `organizations.settings`                                         |
| 10  | Medium   | Indexes     | The overdue index keeps every completed task forever                                            | `tasks_assignee_due_idx`                                                                       |
| 11  | Medium   | Scalability | Sparse board filters can walk the whole project on PostgreSQL 16 (not verified on 16)           | `tasks_project_created_idx` + post-filters                                                     |
| 12  | Medium   | Scalability | `task_activity` growth and synchronous cascades on project delete                               | `task_activity`; `projects` cascades                                                           |
| 13  | Medium   | Security    | Role checks exist only as descriptions in the schema                                            | `Mutation.*` descriptions in `schema.graphql`                                                  |
| 14  | Medium   | Security    | `settings` is unvalidated and fully readable by viewers                                         | `organizations.settings`, `Organization.settings`                                              |
| 15  | Medium   | Security    | The `x-user-id` header trusts the client and nothing prevents it in production                  | Auth assumption, `ASSUMPTIONS.md`                                                              |
| 16  | Low      | Scalability | Random UUIDv4 primary keys on high-insert tables                                                | `tasks.id`, `task_comments.id`                                                                 |
| 17  | Low      | Consistency | `updated_at` maintained by application code only                                                | all `updated_at` columns                                                                       |
| 18  | Low      | Model gap   | No task ordering column; `position` not unique                                                  | `tasks`; `project_statuses.position`                                                           |
| 19  | Low      | Security    | Email exposure and account enumeration                                                          | `User.email`; `addMember(email)`                                                               |

## N+1 query risks

**2. Unbounded nested connections (High).** `first` has a default of 50 but no maximum, and nothing limits query depth. `organizations { projects(first: 50) { tasks(first: 50) { comments(first: 50) } } }` asks for up to 125,000 comments in one request, and a client can pass `first: 100000`. `Organization.labels` is an unpaginated list. _Fix:_ clamp `first` (e.g. to 100) in the resolvers, and add depth and cost limits at the server.

**3. DataLoader does not fix paginated children (High).** The design says DataLoaders remove N+1. That is true only for by-key lookups (`Task.assignee`, `Task.status`, `Task.labels`). `Project.tasks(first: 50)` under a list of projects needs a separate `LIMIT` for each parent, and `WHERE project_id = ANY($1)` cannot express that. A naive resolver runs one query per project, and the same applies to `Task.comments` and `Task.activity`. _Fix:_ batch with `LATERAL` (`FROM unnest($1::uuid[]) p(id) CROSS JOIN LATERAL (SELECT ... WHERE project_id = p.id ORDER BY ... LIMIT $2)`), or do not expose nested paginated lists inside list contexts. Related: `Organization.viewerRole` must come from the memberships already in the request context, not a query per organization.

Also noted: `ActivityEvent.oldValue`/`newValue` hold raw IDs for status and assignee changes. A client rendering an activity feed must resolve each ID, which is another per-row lookup, and an ID dangles if its status is deleted. Store a display snapshot (`{"id": ..., "name": ...}`) alongside the ID.

## Data consistency

**4. Activity history is neither complete nor durable (High).** Two separate problems:

- **Incomplete.** History is written by application code. Any write path that skips the CTE pattern leaves no trace: the bulk task move in `deleteProjectStatus`, admin scripts, data migrations, or a resolver someone forgets to update.
- **Not durable.** `task_activity` references `tasks` with `ON DELETE CASCADE`. Deleting a task erases its history, and deleting a project erases the history of every task in it. There is no `deleted` action. For an audit log this is the wrong default.

_Fix:_ write activity from an `AFTER UPDATE` trigger on `tasks`, with the actor passed via `SET LOCAL app.user_id`. Soft-delete tasks (`deleted_at`) or drop the cascade. Add a `deleted` action.

**7. Owner invariant (Medium).** "The last owner cannot be demoted" exists only in a GraphQL description. Two owners demoting each other at the same time both pass a "count owners > 1" check under READ COMMITTED, leaving the organization with zero owners. _Fix:_ lock the organization's owner rows (`SELECT ... WHERE org_id = $1 AND role = 'owner' FOR UPDATE`) before the check, or use a deferred constraint trigger.

**8. Status category is mutable history (Medium).** `updateProjectStatus(category: DONE)` instantly reclassifies every task in that status. Overdue counts, "completed" reports and the meaning of past activity all change with no record. There are also no transition rules (any status to any status), and no `completed_at`, so "when was this finished" needs a scan of `task_activity`. _Fix:_ add `tasks.completed_at`, set it when a task enters a `done` status. Treat a category change as an explicit operation that recomputes it.

**Denormalized counters.** The schema has none, which avoids drift. The cost moves to reads (finding 5). A counter table would bring back drift risk and add a hot-row write bottleneck per project. **The overdue count cannot be a stored counter at all**, because it changes at midnight with no write.

**17. `updated_at` (Low).** It is set only if every `UPDATE` remembers to set it. _Fix:_ a `BEFORE UPDATE` trigger.

## Scalability at 100x

**5. Summary is O(tasks in project) on every board load (High, measured).** The summary query (`GROUPING SETS`) is a sequential scan plus hash aggregate. It took 4.5 ms at 2,500 tasks and **624 ms at 250,000 tasks**, and it runs on every board load and every filter change. This recreates the Part 3 performance problem at the aggregation layer. _Fix options:_ a covering index `(project_id) INCLUDE (status_id, priority, assignee_id, due_date)` for an index-only scan (still linear, but smaller); a short-TTL cache keyed by project and filters; or a maintained counts table for status and priority, with overdue computed live.

**11. Sparse filters with keyset ordering (Medium, not verified on 16).** The board walks `tasks_project_created_idx` in `created_at` order and applies the priority and due-date filters afterwards. If a filter matches few or no rows, the walk continues until 21 rows are found or the project runs out, which is up to 250,000 rows. On PostgreSQL 18 the planner avoided this with a skip scan on `tasks_assignee_due_idx` (0.5 ms, _measured_). **PostgreSQL 16 has no skip scan**, so the compose target may take the slow path. _Fix:_ measure on 16; add `(project_id, status_id, created_at DESC, id DESC)` for the most common filter; set a `statement_timeout`.

**12. `task_activity` growth and cascades (Medium).** With only one "created" row per task it was already 44 MB at 100x (_measured_), and real usage writes several rows per task. Deleting a project cascades through tasks, labels, comments and activity in one transaction, holding locks for the whole delete. _Fix:_ partition `task_activity` by month on `created_at`; soft-delete projects and purge in batches.

**16. UUIDv4 keys (Low).** Random keys spread inserts across the whole B-tree on `tasks` and `task_comments`, causing page splits and poor cache locality as tables grow. PostgreSQL 16 has no built-in `uuidv7()`. _Fix:_ generate UUIDv7 in the application.

## Security

**1. No database-level guard on reads (Critical).** The technical documentation describes three isolation layers, but only one of them protects **reads**: every query must remember `org_id = ANY(...)`. The composite foreign keys stop cross-tenant writes, not cross-tenant reads.

The documentation's own DataLoader design is unscoped: "one query per relation (`WHERE id = ANY($1)`)". `users` is global, so a user loader keyed only by ID returns any user's name and email to anyone who can get an ID into a resolver. One missing predicate in `Query.task(id)` returns another tenant's task. The documentation presents isolation as stronger than it is.

_Fix:_ route all reads through one data-access function that requires the caller's org IDs, and scope loaders (`WHERE id = ANY($1) AND org_id = ANY($2)`). Add Row-Level Security with `SET LOCAL app.org_ids` per transaction. Add a test per entry point that requests another tenant's ID.

**13. Role checks are descriptions (Medium).** "owner, admin" in a mutation description enforces nothing. A viewer can write through any resolver that forgets the check. _Fix:_ one `requireRole(ctx, orgId, roles)` used by every mutation, plus a role × mutation test matrix.

**14. `settings` (Medium).** Any JSON object is accepted, so typos become silent dead settings. `Organization.settings` returns the whole document to viewers; the first setting that holds a webhook URL or token leaks to every viewer. _Fix:_ a typed `OrganizationSettings` GraphQL type with per-field authorization; validate on write; keep secrets elsewhere.

**15. Development auth (Medium).** `x-user-id` lets any client act as any user. That is acceptable only as a documented local-development shortcut. Nothing in the design stops it from shipping. _Fix:_ refuse header auth when `NODE_ENV=production`.

**19. Email exposure (Low).** `User.email` is visible to every member of every organization the user shares. `addMember(email)` reveals whether an email has an account. _Fix:_ show emails to admins only; use an invite flow that responds the same either way.

## Missing indexes and denormalization opportunities

**6. Unindexed foreign keys to `users` (High, measured).** `projects.created_by`, `tasks.created_by`, `task_comments.author_id` and `task_activity.actor_id` have `ON DELETE SET NULL` but no index. Deleting one user scans all four tables: **4.1 s at 100x**, inside one transaction. The first draft of the technical documentation claimed "every foreign key is indexed on the referencing side"; that was false and has been corrected. _Fix:_ index the four columns. For `task_activity.actor_id`, consider dropping the foreign key and keeping the ID, since audit rows should not change when a user is deleted.

**10. Overdue index keeps completed tasks (Medium, partly measured).** `tasks_assignee_due_idx` covers done tasks forever, and "done" is only known after joining `project_statuses`. The overdue _list_ stays fast at 100x (5 ms, _measured_) because `LIMIT 50` stops the scan early. An overdue _count_ (the summary, or a badge) must read every past-due row the user has ever had, and that set only grows. _Fix (denormalization):_ add `tasks.completed_at` (finding 8) and a partial index `(assignee_id, due_date) WHERE completed_at IS NULL`. The cost is keeping `completed_at` in sync on status and category changes, which the trigger from finding 4 can do.

**9. Time zone of "today" (Medium).** `current_date` is the database session's date. An organization in UTC+5:30 sees tasks flip to overdue at 05:30 local time. _Fix:_ store the organization's time zone in `settings` and pass "today" in that zone as a query parameter.

**18. Ordering (Low).** `tasks` has no rank column, so a Kanban order (the drag-and-drop in Part 3) has nowhere to persist. `project_statuses.position` has no uniqueness, so concurrent reorders produce ties. _Fix:_ a fractional or lexicographic `rank` column when manual ordering is in scope.

## What holds up

These were checked and are not findings:

- The composite `(org_id, ...)` foreign keys rejected all four cross-tenant reference attempts tested (project, status, label, assignee).
- Keyset pagination stayed at index-scan cost at 100x.
- `CHECK` constraints instead of `ENUM` types made the documented constraint migration a short-lock change (validated separately under a weaker lock).
