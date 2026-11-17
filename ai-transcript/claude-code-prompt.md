# Prompt for Claude Code: Senior Full-Stack Take-Home (Task Board)

> Paste everything below this line into Claude Code, started in an empty folder. Put the assessment PDF in that folder as `assessment.pdf`.

---

## Role and ground rules

You are pair-programming with me (Yash, a senior backend engineer: Node.js, PostgreSQL, GraphQL, AWS) on a take-home assessment for a Senior Full-Stack Developer (IC4/IC5) role. I own this submission end-to-end. Build it the way I would as a single developer shipping a small but production-minded project. **Do not** build it like a generated demo.

The full source of truth is `assessment.pdf` in this folder. Read it first. If anything in this prompt conflicts with the PDF, the PDF wins. Tell me about the conflict.

**Hard rules (apply to every phase):**

1. **Do not deviate from the requirements.** Build only what the assessment asks for. Do not add features, pages, endpoints, mutations, auth flows, settings screens, drag-and-drop, real-time updates, CI pipelines, Dockerising the app itself, or styling frameworks unless a requirement below needs them. If you think something extra is needed, **ask me first** and say which requirement it serves.
2. **No unnecessary code.** Every file and function must trace back to a numbered requirement (R-x below). No speculative abstractions, unused helpers, boilerplate generators, or commented-out code. Keep each part isolated in its own folder.
3. **Work phase by phase.** At the end of each phase, **STOP**. Show me a short summary: files created, which requirements are covered, assumptions made, and anything for me to verify. Wait for my "go" before the next phase. I will review and iterate. This conversation is part of the submission (the assessors grade how I prompt, iterate and validate AI output), so keep your reasoning clear and professional.
4. **Write it as my work.** Use plain, direct engineering language in docs and comments. No marketing tone, no emoji, no "As an AI…". Comments explain *why*, not *what*.
5. **Record assumptions.** Whenever the spec is ambiguous, choose the simplest reasonable option and add it to `ASSUMPTIONS.md` (one line each: assumption + reason).
6. **Respect word and page limits exactly.** Count words for the limited sections and report the count.
7. **Verify, don't claim.** Run the code, the migrations, the queries and the type checks before you say something works. Show me the command output.

---

## Requirements checklist (from the PDF)

### Part 1: System design and AI critique (90–120 min budget)

**R-1.1 Data model (GraphQL + PostgreSQL)**
- Multiple organizations, each with its own projects and team members
- Projects contain tasks with assignee, priority, status, labels, due date
- Task comments and activity history (who changed what, when)
- Role-based access control per organization: `owner`, `admin`, `member`, `viewer`
- Workspace-level (organization) settings
- Customizable task statuses per project
- Deliverables: GraphQL type definitions **and** SQL `CREATE TABLE` statements (raw SQL, not ORM)

**R-1.2 Technical documentation (2–3 pages, markdown)**, built from the R-1.1 schema:
- Data model rationale and entity relationships (include a Mermaid ER diagram)
- Query patterns for common operations. Must include *"get all overdue tasks assigned to me across projects"* with the actual SQL
- Indexing strategy and performance considerations
- Multi-tenancy isolation approach
- Migration strategy for evolving the schema

**R-1.3 AI architecture critique**
- Critically analyse the R-1.1 schema for:
  - N+1 query risks in GraphQL resolvers
  - Data consistency challenges (denormalized counters, status transitions)
  - Scalability bottlenecks at 100x data volume
  - Security concerns (tenant isolation, authorization gaps)
  - Missing indexes or denormalization opportunities
- Be honestly critical of the schema, including choices you made yourself. Don't defend it.
- Deliverable 1: `ai-critique.md` (your critique output)
- Deliverable 2: `my-analysis.md` is **written by me, not you** (500–750 words: do I agree, what did the AI miss, what to fix first and why). Create the file with only these headings: *Where I agree*, *Where I disagree*, *What the critique missed*, *What I would fix first and why*. Leave the body empty. Later I may ask you to review my draft or check its word count. Do not write it for me.

### Part 2: Full-stack implementation (90–120 min budget)

**R-2.1 Backend: Node.js GraphQL API**
- Query tasks with filtering by **status, assignee, priority, due date range** (filters combine with AND)
- **Cursor-based pagination** for large task lists (keyset, Relay-style `edges/node/pageInfo/endCursor/hasNextPage`, stable sort with a tiebreaker on `id`). No OFFSET.
- **Summary/aggregation query**: task counts by status, overdue count, tasks per assignee (plus counts by priority, because R-2.2 needs them)
- **Authorization**: a user sees tasks only in organizations they belong to. Enforce it on the server for every query path, including the summary.
- Avoid N+1 (DataLoader for assignee/status/labels), which ties back to R-1.3
- Deliverables: schema (type definitions), resolvers (**at least 80 lines of meaningful logic**, not counting boilerplate), `backend-design.md` (**200–300 words**)

**R-2.2 Frontend: React Task Board**
- React + **TypeScript + hooks**, consuming the R-2.1 API
- **Filterable table** (chosen over Kanban to stay in scope). Filters: status, assignee, priority, due date range. "Load more" uses the cursor.
- **Summary stats**: total tasks, overdue count, distribution by priority
- **At least one chart** (priority distribution or status breakdown; one library, e.g. Recharts)
- **Loading, error and empty states** handled properly (including "no results for these filters" and "load more" errors)
- Deliverables: component code, `frontend-architecture.md` (**200–300 words** on state management and component architecture)

### Part 3: RFC (60–90 min budget)

**R-3.1 RFC (2–3 pages, markdown), audience: engineering team + product manager**
Scenario: 500+ orgs. Task board unusable for 2,000+ task projects. It fetches all tasks in one query, renders the full Kanban client-side, refetches everything on each filter or status change. Page load 6–8 s. Drag-and-drop reorder triggers a full refetch.
- Problem statement framed with data and metrics (state where numbers are assumed)
- At least 2 options evaluated with trade-offs (a comparison table)
- Recommended solution with a phased implementation plan
- Performance targets (what "good" looks like: e.g. p95 load, payload size, time to interactive, reorder latency)
- Rollout strategy (feature flags, gradual org cohorts, metrics and kill switch, rollback)
- Where it fits, refer to what Part 2 already implements (keyset pagination, server-side filtering, summary query)

### Submission

**R-4 Submission packaging**
- One GitHub repo with a clear root `README.md`: overview, structure, how to run, mapping of each requirement to its file, assumptions
- All docs in markdown. Code formatted and commented.
- Root `package.json` so the assessors can run it with a few commands
- `ai-transcript/` folder: I will add the full unedited transcript of this conversation, plus `prompting-strategy.md` (brief commentary, which **I write**. Create only the headings).

---

## Technical decisions (fixed; don't change without asking)

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript (backend and frontend) | Type safety on both sides |
| API | Node.js 20 + Apollo Server 4 (standalone) | Standard, minimal setup |
| DB | PostgreSQL 16 via `docker-compose.yml` (DB only) | Matches the R-1.1 SQL |
| DB access | `pg` with parameterised raw SQL, no ORM | Shows the SQL and indexing work directly |
| Migrations | Plain numbered `.sql` files + a tiny runner script | Matches R-1.2 migration strategy |
| N+1 | `dataloader` | R-1.3 / R-2.1 |
| Auth (assumption) | Dev-only `x-user-id` header to pick the current user; the server resolves memberships from the DB. No login UI. | Spec asks for authorization, not authentication |
| Frontend | Vite + React 18 + TypeScript + Apollo Client + Recharts | Minimal |
| Styling | Plain CSS modules or one small CSS file | No UI framework |
| Tests | A few focused backend integration tests (Vitest): tenant isolation, filters, pagination, summary | Proves R-2.1 claims, nothing more |

The R-2.1 database **must be the R-1.1 schema** (same migrations). The R-2.1 GraphQL API exposes only the subset Part 2 needs. Don't implement the rest of the R-1.1 schema in resolvers.

---

## Target repository structure

```
/
├── README.md
├── ASSUMPTIONS.md
├── package.json                 # npm workspaces + root scripts (db:up, migrate, seed, dev, test)
├── docker-compose.yml           # PostgreSQL only
├── part1-design/
│   ├── schema.graphql           # R-1.1 full GraphQL types
│   ├── schema.sql               # R-1.1 CREATE TABLE + indexes (source for migration 001)
│   ├── technical-documentation.md   # R-1.2
│   ├── ai-critique.md           # R-1.3 (AI output)
│   └── my-analysis.md           # R-1.3 (headings only; I write it)
├── part2-implementation/
│   ├── backend/
│   │   ├── package.json
│   │   ├── migrations/          # 001_init.sql (= schema.sql)
│   │   ├── src/
│   │   │   ├── index.ts         # server bootstrap
│   │   │   ├── context.ts       # current user + memberships + loaders
│   │   │   ├── schema.graphql   # R-2.1 API subset
│   │   │   ├── resolvers/tasks.ts       # filters, pagination, summary, authz
│   │   │   ├── loaders.ts       # DataLoaders
│   │   │   ├── cursor.ts        # encode/decode keyset cursor
│   │   │   └── db.ts
│   │   ├── scripts/migrate.ts, seed.ts   # seed: 2 orgs, several users/roles, ~2,500 tasks in one project
│   │   └── test/tasks.test.ts
│   ├── frontend/
│   │   ├── package.json
│   │   └── src/ (App.tsx, components/TaskBoard/*, graphql/queries.ts, hooks/useTasks.ts, hooks/useTaskSummary.ts)
│   ├── backend-design.md        # R-2.1 (200–300 words)
│   └── frontend-architecture.md # R-2.2 (200–300 words)
├── part3-rfc/
│   └── rfc-task-board-performance.md   # R-3.1
└── ai-transcript/
    └── prompting-strategy.md    # headings only; I write it, then add the transcript export
```

The seed must create a cross-tenant case (a user who belongs to org A only, with tasks in org B) so the authorization behaviour can be shown and tested. It must also create a project with 2,000+ tasks, to tie back to the Part 3 scenario.

---

## Phased plan (3 days)

**Phase 0: Setup and plan (Day 1, start)**
- Read `assessment.pdf`. Confirm or point out corrections to the requirements checklist above.
- Check the toolchain: `node -v` (≥20), `npm -v`, `docker --version`, `docker compose version`, `git --version`. Tell me what is missing **before** you write code.
- Create the folder skeleton, root `package.json` with workspaces, `docker-compose.yml`, `.gitignore`, empty `ASSUMPTIONS.md`, and `git init`.
- **STOP.**

**Phase 1: Part 1 (Day 1)**
1. R-1.1: `schema.sql` first (tables, FKs, constraints, enums or check constraints, indexes, `org_id` on every tenant-scoped table), then `schema.graphql`. Validate the SQL by applying it to the local Postgres. **STOP** for my review. I will iterate on the schema before the docs are written.
2. R-1.2: `technical-documentation.md`, 2–3 pages, using the final schema. Check that every SQL example runs against the schema. **STOP.**
3. R-1.3: `ai-critique.md`. Critique the schema as a skeptical staff engineer would, give a severity for each finding, and point to the exact table, column or resolver it concerns. Create `my-analysis.md` with headings only. **STOP.**

**Phase 2: Part 2 (Day 2)**
1. Backend: migrations, seed, context and authz, `tasks` query (filters + keyset pagination), `taskSummary` query, DataLoaders, tests. Run migrations, seed and tests. Show sample queries and responses, including one rejected or empty cross-tenant request. Report the resolver logic line count. **STOP.**
2. Frontend: table, filters, load more, summary stats, one chart, loading/error/empty states. Run `tsc --noEmit` and the dev build. **STOP.** I will check it in the browser.
3. `backend-design.md` and `frontend-architecture.md` (200–300 words each, word count reported). **STOP.**

**Phase 3: Part 3 + packaging (Day 3)**
1. R-3.1 RFC, 2–3 pages. **STOP** for review.
2. Root `README.md` (setup in ≤5 commands, requirement-to-file map, assumptions link), `prompting-strategy.md` headings, final cleanup: remove unused code and deps, format, check every R-x is covered. Give me a final checklist table: R-x → file → status. **STOP.**

---

## Items that may take longer (flag these to me early)

- **Docker / PostgreSQL** install and first image pull. If Docker is unavailable, tell me and propose a local Postgres connection string instead.
- **npm installs** for two workspaces (Apollo, React, Recharts, Vitest).
- **Seeding 2,500+ tasks.** Use batched multi-row inserts or `generate_series`, not one insert per row.
- **GitHub repo**: I need to create it and push. Remind me at the end of Phase 3.
- **AI transcript export.** I must export this full conversation unedited (Claude Code `/export`, or the session log in `~/.claude/projects/`). Remind me at the end, and **don't clear or compact context** in a way that loses the transcript without warning me first.
- **My own writing**: `my-analysis.md` (500–750 words) and `prompting-strategy.md`. Remind me these are pending at each STOP from Phase 1.3 onward.

---

Start with **Phase 0** now.
