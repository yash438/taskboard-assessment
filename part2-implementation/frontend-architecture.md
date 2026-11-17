# Frontend Architecture Decisions

**State management.** There are two kinds of state, and each lives in one place.

- **Server state** (projects, task pages, summary) lives in the Apollo Client cache. There is no Redux or context store: the cache already de-duplicates requests, normalises tasks and users by `id`, and returns a previously seen filter instantly.
- **UI state** is small and local. The selected project lives in `App`; the filter form values live in `TaskBoard` (`useState`). The GraphQL filter is derived from the form values with `useMemo`, so Apollo sees stable variables and does not refetch on unrelated renders.

**Pagination in the cache.** The `tasks` field is keyed by `projectId` and `filter` only. "Load more" calls `fetchMore` with the cursor, and a merge function appends the new page to the list for that filter. A changed filter is a new list; returning to an earlier one reuses the cached pages.

**Component structure.**

- `TaskBoard` is the only stateful component. It owns the filter state, calls the two hooks, and chooses what each region shows.
- `FilterBar`, `SummaryStats`, `PriorityChart` and `TaskTable` are presentational: they receive data and callbacks as props.
- Data access sits in two hooks. `useTasks` wraps the paginated query and tracks a separate "load more" error. `useTaskSummary` wraps the summary query.

**Loading, error and empty states.** The table and the summary load and fail independently, so a slow summary never blocks the list. A failed "load more" shows an inline retry and keeps the rows already loaded. An empty project and a filter that matches nothing show different messages, and the second offers "Clear filters". Errors become actions, such as "start the API".

**Trade-offs.** Types are hand-written rather than generated, and filters are not synced to the URL. Both are reasonable next steps.
