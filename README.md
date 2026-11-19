# Task Board: Senior Full-Stack Take-Home

A multi-tenant project management data model (Part 1), a task board built on it with a Node.js GraphQL API and a React UI (Part 2), and an RFC for making the board fast on large projects (Part 3).

## Repository structure

```
part1-design/                  Data model, technical documentation, AI critique, my analysis
part2-implementation/
  backend/                     Apollo Server 4 + PostgreSQL (raw SQL via pg), migrations, seed, tests
  frontend/                    Vite + React 18 + TypeScript + Apollo Client + Recharts
  backend-design.md            API design decisions
  frontend-architecture.md     State management and component structure
part3-rfc/                     RFC: task board performance for large projects
ai-transcript/                 Full AI transcript and my notes on prompting strategy
ASSUMPTIONS.md                 Every assumption made where the spec was open
docker-compose.yml             PostgreSQL 16 only
```

## Running it

Requires Node.js 20.12 or later, and either Docker or an existing PostgreSQL 16+ database.

```bash
cp .env.example .env                 # Windows: copy .env.example .env. Edit DATABASE_URL if not using Docker.
npm install
npm run db:up                        # PostgreSQL 16 in Docker; skip if DATABASE_URL points at your own database
npm run migrate && npm run seed      # schema (part1-design/schema.sql) + 2 orgs, 7 users, 2,660 tasks
npm run dev:api                      # http://localhost:4000 (GraphQL); run dev:web in a second terminal
```

Then run `npm run dev:web` in a second terminal and open http://localhost:5173. Run `npm test` for the backend integration tests; it needs the seeded database.

**Who you are.** There is no login. The web app sends `VITE_USER_ID` from `.env` as the `x-user-id` header, and the API looks up that user's memberships. Change it and restart `dev:web` to view the board as someone else:

| User          | `x-user-id`                            | Memberships                     |
| ------------- | -------------------------------------- | ------------------------------- |
| Alice Owner   | `20000000-0000-4000-8000-000000000001` | Acme (owner); **not** in Globex |
| Victor Viewer | `20000000-0000-4000-8000-000000000004` | Acme (viewer)                   |
| Sam Both      | `20000000-0000-4000-8000-000000000007` | Acme and Globex (member)        |

Acme owns **Platform** (2,500 tasks, the large-project case from the RFC) and **Website** (40). Globex owns **Mobile App** (120). Alice requesting Mobile App gets `NOT_FOUND`. The seed prints all user IDs.

To call the API directly:

```bash
curl -s http://localhost:4000/ -H 'content-type: application/json' \
  -H 'x-user-id: 20000000-0000-4000-8000-000000000001' \
  -d '{"query":"{ taskSummary(projectId: \"30000000-0000-4000-8000-000000000001\") { total overdue byPriority { priority count } } }"}'
```

## Requirements map

| Requirement                                | Deliverable                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Data model: GraphQL types + SQL        | [`part1-design/schema.graphql`](part1-design/schema.graphql), [`part1-design/schema.sql`](part1-design/schema.sql)                                                                                                                                                                                                                                                   |
| 1.2 Technical documentation                | [`part1-design/technical-documentation.md`](part1-design/technical-documentation.md)                                                                                                                                                                                                                                                                                 |
| 1.3 AI critique                            | [`part1-design/ai-critique.md`](part1-design/ai-critique.md)                                                                                                                                                                                                                                                                                                         |
| 1.3 My analysis (500–750 words)            | [`part1-design/my-analysis.md`](part1-design/my-analysis.md)                                                                                                                                                                                                                                                                                                         |
| 2.1 GraphQL schema                         | [`part2-implementation/backend/src/schema.graphql`](part2-implementation/backend/src/schema.graphql)                                                                                                                                                                                                                                                                 |
| 2.1 Resolvers                              | [`part2-implementation/backend/src/resolvers/tasks.ts`](part2-implementation/backend/src/resolvers/tasks.ts) (filters, keyset pagination, summary, authorization), [`projects.ts`](part2-implementation/backend/src/resolvers/projects.ts), [`loaders.ts`](part2-implementation/backend/src/loaders.ts), [`context.ts`](part2-implementation/backend/src/context.ts) |
| 2.1 Design decisions (200–300 words)       | [`part2-implementation/backend-design.md`](part2-implementation/backend-design.md)                                                                                                                                                                                                                                                                                   |
| 2.1 Tests                                  | [`part2-implementation/backend/test/tasks.test.ts`](part2-implementation/backend/test/tasks.test.ts)                                                                                                                                                                                                                                                                 |
| 2.2 React components                       | [`part2-implementation/frontend/src/`](part2-implementation/frontend/src/) (`components/TaskBoard/*`, `hooks/*`)                                                                                                                                                                                                                                                     |
| 2.2 Architecture decisions (200–300 words) | [`part2-implementation/frontend-architecture.md`](part2-implementation/frontend-architecture.md)                                                                                                                                                                                                                                                                     |
| 3.1 RFC                                    | [`part3-rfc/rfc-task-board-performance.md`](part3-rfc/rfc-task-board-performance.md)                                                                                                                                                                                                                                                                                 |
| AI transcript + prompting strategy         | [`ai-transcript/`](ai-transcript/)                                                                                                                                                                                                                                                                                                                                   |

The Part 2 database uses the Part 1 schema unchanged: `backend/migrations/001_init.sql` is a byte-for-byte copy of `part1-design/schema.sql`. The Part 2 API exposes only the subset the task board needs.

## What was verified, and how

- **Schema:** applied to a fresh database. Every cross-tenant reference (project, status, label, assignee) is rejected by composite foreign keys.
- **Documentation SQL:** every SQL statement in the technical documentation was run against the schema.
- **Critique measurements:** the scalability numbers in the critique come from `EXPLAIN ANALYZE` on a 250,000-task project.
- **Backend:** 15 integration tests over real HTTP: authentication, tenant isolation, each filter and their combination, input validation, a full walk of 2,500 tasks with no gaps or duplicates, summary counts compared against independent SQL, and a constant six SQL queries per page whether it holds 10 tasks or 100. Removing tenant scoping from the resolver makes the isolation tests fail.
- **Frontend:** type-checks under strict mode and builds for production. Its query documents were run against the live API.
- **Not verified:** the Docker path. Development used a local PostgreSQL 18 because Docker was not available; the SQL avoids features newer than 16.

## Assumptions

See [`ASSUMPTIONS.md`](ASSUMPTIONS.md). The main ones:

- Authentication is out of scope; the dev-only header above stands in for it.
- The board is a filterable table, not a Kanban board.
- "Workspace" means organization.
- Overdue means the due date is before today and the status is not in a done category.
