# RFC: Task Board Performance for Large Projects

|               |                                               |
| ------------- | --------------------------------------------- |
| **Status**    | Draft for review                              |
| **Author**    | Yash                                          |
| **Reviewers** | Board team engineers, Product (task board PM) |
| **Date**      | 2026-11-17                                    |

## 1. Summary

The task board fetches every task in a project, renders all of them, and refetches everything after any filter change or drag-and-drop. For projects with 2,000+ tasks, the page takes 6–8 s to load. We propose making the board **server-driven**: each column loads its own first page, filtering and counting happen on the server, and moves are applied in place without a full refetch. The target is a p95 load under 1.5 s with no change to how the board looks or behaves for users.

## 2. Problem

**What users see.** Large-project boards take 6–8 s to become usable, and every filter change or card move repeats most of that cost. The organizations with the biggest projects are typically our largest accounts, so the slowest experience falls on the customers we can least afford to frustrate.

**Why it happens.** Numbers marked _(assumed)_ are estimates to confirm in Phase 0; the others come from the current behaviour or from the Part 2 prototype.

| Cause                                                         | Effect at 2,000 tasks                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| One query returns every task with assignee, labels and status | ~1.5 KB per task → **~3 MB JSON** per load _(assumed)_                                  |
| The whole Kanban is rendered client-side                      | ~25 DOM nodes per card → **~50,000 nodes** _(assumed)_; slow first render and scrolling |
| Every filter change refetches everything                      | each filter click costs a full load (**6–8 s**)                                         |
| Drag-and-drop triggers a full refetch                         | a card move takes seconds to settle; concurrent edits flicker                           |
| Counts are computed from the loaded list                      | the client must load every task just to show column totals                              |

**Evidence that the server is not the bottleneck.** The Part 2 prototype, using the same data model and a seeded 2,500-task project, measured:

| Query                                                                | Time   |
| -------------------------------------------------------------------- | ------ |
| One 50-task page with filters, via keyset pagination (`tasks` query) | 0.3 ms |
| Board summary over 2,500 tasks (one `GROUP BY` query)                | 4.5 ms |

The time goes into transferring and rendering data the user never looks at.

## 3. Goals and non-goals

**Goals:** fast first load for any project size; filter and move latency independent of project size; accurate column counts; no visible change to board features.

**Non-goals:** real-time collaboration, offline support, a board redesign. These are worth doing but are separate decisions.

## 4. Options

**A. Optimise the client only.** Keep the single fetch. Virtualise columns so only visible cards render, cache the response, and make moves optimistic (shown immediately).

**B. Server-driven board (recommended).**

- Each column requests its first page (about 30 cards) using keyset pagination, and more as the user scrolls.
- Filters run on the server.
- Column counts come from a summary query.
- Moves call a small mutation and patch the client cache; nothing is refetched.

**C. Local-first sync engine.** Replicate project data into the browser (IndexedDB) and keep it current with delta sync over a WebSocket, so reads become local.

|                           | A. Client only       | **B. Server-driven**       | C. Sync engine                                |
| ------------------------- | -------------------- | -------------------------- | --------------------------------------------- |
| First load at 2,000 tasks | ~4 s (still ~3 MB)   | **< 1.5 s (~100 KB)**      | slow first visit, instant afterwards          |
| Filter change             | fast after load      | **~200–300 ms round trip** | instant                                       |
| Scales to 20,000+ tasks   | no                   | **yes**                    | needs per-project data limits                 |
| Move latency              | instant (optimistic) | **instant (optimistic)**   | instant                                       |
| Build effort              | ~2 weeks             | **~6–7 weeks**             | quarter or more, new infrastructure           |
| Delivery risk             | low                  | **medium**                 | high (conflicts, schema sync, storage limits) |
| Reuses existing work      | partially            | **yes: Part 2 API**        | no                                            |

Option A is a useful first step but does not survive the next order of magnitude, because payload size still grows with every task. Option C gives the best experience but is a platform investment, and it should be decided on its own merits, not as a performance fix.

## 5. Recommended design (Option B)

Most of the read path already exists in the Part 2 API:

- `tasks(projectId, filter, first, after)` supports **server-side filtering** and **keyset pagination**: stable under concurrent inserts, with constant cost per page.
- `taskSummary(projectId, filter)` returns **per-status counts** in one query. These become the column header totals.
- Authorization is enforced on every path.

New work:

1. **Per-column loading.** The board issues one `tasks` query per column (`filter.statusIds = [column]`, `first: 30`), batched into a single HTTP request. Scrolling within a column fetches the next page using the cursor.
2. **Manual ordering.** Add a `rank` column to `tasks`: a fractional or lexicographic key, so a move updates one row. Add an index `(project_id, status_id, rank, id)`. The column sort becomes `rank, id`.
3. **`moveTask(id, statusId, afterTaskId)` mutation.** It returns only the updated task and writes the activity row in the same transaction. The client applies an optimistic update to the Apollo cache and adjusts the two column counts locally. **Nothing is refetched.** On failure, the cache rolls back and an error toast is shown.
4. **Virtualised columns** (from option A). Only visible cards are in the DOM.
5. **Summary cost at scale.** At 250,000 tasks the summary scan takes 624 ms. Add a covering index and a short-lived (30 s) cache keyed by project and filter, invalidated on writes.

## 6. Performance targets

Measured with real-user monitoring (RUM) on projects with 2,000+ tasks, unless stated otherwise.

| Metric                                        | Today               | Target                            |
| --------------------------------------------- | ------------------- | --------------------------------- |
| Board load to interactive, p95                | 6–8 s               | **≤ 1.5 s**                       |
| Initial payload                               | ~3 MB _(assumed)_   | **≤ 150 KB**                      |
| Filter change to updated board, p95           | 6–8 s               | **≤ 300 ms**                      |
| Card move, visual feedback                    | seconds             | **≤ 100 ms** (optimistic)         |
| Card move, server confirmation, p95           | full refetch        | **≤ 250 ms**; zero full refetches |
| `tasks` page / `taskSummary` API latency, p95 | n/a                 | **≤ 50 ms / ≤ 100 ms**            |
| DOM nodes on the board                        | ~50,000 _(assumed)_ | **≤ 3,000**                       |

## 7. Implementation plan

| Phase                             | Scope                                                                                                                                                     | Estimate  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0. Baseline                       | Add RUM for load, filter and move timings and payload size; confirm the assumed numbers                                                                   | 1 week    |
| 1. Server-driven reads            | Per-column paginated queries, server-side filters, counts from `taskSummary`, behind a flag                                                               | 2–3 weeks |
| 2. Moves without refetch          | Add `rank` in expand/contract steps (add the column, backfill in batches, then switch reads); add the `moveTask` mutation and the optimistic cache update | 2 weeks   |
| 3. Rendering and summary at scale | Column virtualisation; covering index and short-lived cache for the summary                                                                               | 1 week    |
| 4. Cleanup                        | Remove the fetch-everything query and the flag once 100% of organizations are stable for 2 weeks                                                          | 0.5 week  |

## 8. Rollout

- **Feature flag per organization** (`board_v2`). The old and new paths coexist until Phase 4.
- **Cohorts:** internal organizations, then 5% of organizations, then large-project organizations as an opt-in beta, then 25%, 50% and 100%. Each step waits at least 3 days on healthy metrics.
- **Metrics per cohort**, comparing flag on with flag off: the section 6 targets, API error rate, move failure rate, and support tickets tagged "board".
- **Kill switch.** Turning the flag off returns an organization to the old board immediately. Any cohort is rolled back automatically if p95 load regresses by more than 20%, error rate rises above 1%, or move failures exceed 0.5%.
- **Schema safety.** `rank` is added as nullable, backfilled in batches, and only then relied on. Rolling back the code never requires rolling back the database.
- **Communication.** Support gets a short FAQ before the beta. PM announces it in the changelog at 100%.

## 9. Risks and open questions

- **Rank exhaustion.** Repeated moves between the same two cards can run out of key precision. Rebalance the column in a background job when keys get too long.
- **Counts vs. visible cards.** A column header can say "412" while showing 30 cards. _PM: is "30 of 412" with scroll-to-load acceptable, or do we need "jump to end"?_
- **Bulk actions** that expect every task to be loaded (select all, export) must become server-side operations. _PM: which of these are used on large boards?_
- **Search.** Today it filters loaded cards client-side; with paging it must become a server-side text search, a follow-up RFC if needed.
