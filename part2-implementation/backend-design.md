# Backend Design Decisions

**API shape.** `tasks(projectId, filter, first, after)` returns a Relay-style connection. `taskSummary(projectId, filter)` takes the same filter, so the stats always describe the rows in the table. `projects` supplies the filter options. Filters combine with AND, and the SQL includes only the predicates that are set.

**Authorization.** The `x-user-id` header names the caller, a development stand-in for real authentication. The server reads that user's memberships from the database once per request. Every query and every DataLoader is scoped by `org_id = ANY(<member orgs>)`, which closes the critical gap in the Part 1 critique. A project in another organization returns the same `NOT_FOUND` as a missing one, so its existence never leaks. Tests check this and fail when the scoping is removed.

**Pagination.** Keyset, never `OFFSET`. Rows are ordered by `(created_at DESC, id DESC)`; the cursor is that pair, compared in index order, so page 25 costs the same as page 1. The cursor keeps the microsecond timestamp, because a JavaScript `Date` would round it and skip rows. One extra row is fetched to compute `hasNextPage`, and `first` is capped at 100.

**Summary.** One `GROUPING SETS` query computes counts by status, priority and assignee, plus the total and overdue count, in a single pass. Statuses and priorities with no tasks are filled in with zero.

**N+1.** Per-request DataLoaders batch status, assignee and label lookups. A page costs six queries whether it holds 10 tasks or 100, and a test asserts this.

**Errors.** Malformed input returns `BAD_USER_INPUT`. Unexpected errors are logged on the server and returned to the client without SQL text or stack traces.

**Known limit.** The summary scans every task in the project: about 5 ms at 2,500 tasks, but 624 ms at 250,000. The Part 3 RFC addresses this.
