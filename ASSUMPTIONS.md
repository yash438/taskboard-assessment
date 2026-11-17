# Assumptions

- "Workspace" in the spec means organization; workspace settings live on the organization. Reason: the spec uses both terms for the same tenant boundary.
- Authentication is out of scope; a dev-only `x-user-id` header selects the current user and the server loads that user's memberships from the database. Reason: the spec asks for authorization, not login.
- The task board is a filterable table, not a Kanban board. Reason: the spec allows either; a table fits filtering and cursor pagination without adding drag-and-drop.
- The schema is written for PostgreSQL 16 and avoids features added later. Reason: `docker-compose.yml` pins 16; development was verified against a local PostgreSQL 18 because Docker was not available on the development machine.
- Team members belong to an organization, not to individual projects; every member can see every project in their organization. Reason: the spec lists RBAC per organization only.
- Labels are defined per organization and shared across its projects. Reason: keeps one label set per workspace; the spec does not ask for per-project labels.
- Priority is a fixed set: low, medium, high, urgent. Reason: the spec makes statuses customizable but not priorities.
- Each custom status maps to one of three fixed categories (todo, in_progress, done). Reason: "overdue" and "completed" need a meaning that does not depend on what a project calls its statuses.
- A due date is a calendar date, not a timestamp; a task is overdue when due_date is before today and its status category is not done. Reason: matches how due dates are usually set in task tools and keeps the overdue query simple.
- Activity history covers task creation and field changes on tasks. Comments are stored in their own table with author and timestamp, so they are not duplicated into the activity log. Reason: "who changed what, when" is about task changes.
- The task board is per project: `tasks` and `taskSummary` take a required `projectId`. Reason: the Part 3 scenario describes a per-project board.
- A project outside the caller's organizations returns `NOT_FOUND`, the same as a project that does not exist. Reason: the response must not confirm that another tenant's project exists.
- All four roles can read the board; Part 2 has no writes, so role differences do not apply to it. Reason: the spec's Part 2 API is read-only.
- `taskSummary` takes the same filter as `tasks`. Reason: the stats then describe the rows on screen.
- Tasks are listed newest first (`created_at DESC, id DESC`), and a page holds 1 to 100 tasks (default 50). Reason: a stable keyset order needs a unique tiebreaker, and a page-size cap bounds the cost of one request.
- "Today" for the overdue count is the database server's `current_date`. Reason: the schema has no per-organization time zone yet (see finding 9 in `part1-design/ai-critique.md`).
- The web app acts as the user in `VITE_USER_ID` (root `.env`); to view the board as someone else, change it and restart `npm run dev:web`. Reason: no login UI is in scope.
- The UI filters take one value each (one status, one assignee, one priority), although the API accepts lists. Reason: single selects cover the board's needs with the least UI code; the API keeps lists so a multi-select needs no backend change.
