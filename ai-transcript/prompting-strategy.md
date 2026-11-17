# Prompting Strategy

I used Claude Code for the whole assessment in one session, so the transcript shows every prompt, correction and verification step. These notes explain how I ran it.

## How I structured the work

Before writing any code I wrote a detailed setup prompt ([`claude-code-prompt.md`](claude-code-prompt.md)). It contains:

- **Requirements.** Each requirement from the PDF is numbered (R-1.1 to R-4), so every file has to trace back to one.
- **Fixed decisions.** The technical choices are written down (raw SQL with `pg`, Apollo Server 4, a table instead of a Kanban board), so the AI would not re-decide them.
- **Hard rules.** No features beyond the spec; ask before adding anything; record assumptions; respect word and page limits; show command output instead of claiming success.
- **Phases.** The work is split into phases with a stop for review after each one.

I started in plan mode, so the first output was a plan and a check of the requirements against the PDF, not code. Midway I tightened the instruction to "do not deviate". Later, once the approach was proven, I let the remaining phases run in one pass.

## How I validated the AI's output

I asked for evidence, not assertions, and the session shows these checks being run:

- **Schema.** It was applied to a fresh database, and each kind of cross-tenant insert was attempted; all were rejected.
- **Documentation SQL.** Every SQL block in the technical documentation was extracted and prepared against the real schema.
- **Critique.** The critique's scalability claims were measured with `EXPLAIN ANALYZE` on 250,000 tasks, instead of being taken on trust.
- **Backend tests.** They compare API results against independent SQL, not against the resolver code. Then the tenant scoping was removed on purpose to confirm the tests fail.
- **Frontend contract.** The frontend's query documents were run against the live API.
- **Limits.** Word counts and page estimates were measured by script.

## Where I corrected or redirected the AI

- **Database.** I pasted the credentials of an existing database. The AI created a separate `taskboard` database rather than writing into it, which was the right call.
- **Page limits.** The first draft of the technical documentation was about four pages. I held it to the 2–3 page limit, and content was cut rather than the limit stretched.
- **A false claim in my own documentation.** The 100x measurements contradicted a sentence in the technical documentation ("every foreign key is indexed"). The documentation was corrected, and the critique records the mistake.
- **Bad checks.** A first performance test checked the wrong case and proved nothing. It was rerun with a filter that has no index, and the result was reported as unverified on PostgreSQL 16 because the local server was 18.
- **Stack traces.** The `curl` output showed stack traces in error responses. That was fixed before moving on.
- **Before committing,** I asked for a full review that trimmed over-detailed comments and tidied the structure.

## What I would do differently

- **Run the target database version from day one.** Docker was not available, and testing on PostgreSQL 18 hid a plan difference that matters on 16.
- **Agree the page measurement up front.** Markdown has no fixed page size, and estimating it repeatedly cost time.
- **Write my critique notes before reading the AI's critique,** so my assessment is less anchored to its list.
- **Decide the Apollo Server version before the first commit.** I fixed v4 in my prompt without checking that it had reached end-of-life.
