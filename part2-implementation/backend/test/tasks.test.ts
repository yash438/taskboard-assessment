import type { ApolloServer } from '@apollo/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Context } from '../src/context';
import { pool } from '../src/db';
import { startServer } from '../src/server';

// Runs against the seeded database. Expected values come from plain SQL here, not from resolver code.

// Fixed IDs from scripts/seed.ts.
const ALICE = '20000000-0000-4000-8000-000000000001'; // Acme owner, not in Globex
const VICTOR = '20000000-0000-4000-8000-000000000004'; // Acme viewer
const SAM = '20000000-0000-4000-8000-000000000007'; // member of Acme and Globex
const PLATFORM = '30000000-0000-4000-8000-000000000001'; // Acme, 2,500 tasks
const WEBSITE = '30000000-0000-4000-8000-000000000002'; // Acme
const MOBILE = '30000000-0000-4000-8000-000000000003'; // Globex

const TASKS = `query Tasks($projectId: ID!, $filter: TaskFilter, $first: Int, $after: String) {
  tasks(projectId: $projectId, filter: $filter, first: $first, after: $after) {
    edges { cursor node { id title priority dueDate createdAt status { id name category } assignee { id name } labels { id name } } }
    pageInfo { endCursor hasNextPage }
  }
}`;

const SUMMARY = `query Summary($projectId: ID!, $filter: TaskFilter) {
  taskSummary(projectId: $projectId, filter: $filter) {
    total overdue
    byStatus { status { id } count }
    byPriority { priority count }
    byAssignee { assignee { id } count }
  }
}`;

interface GqlResponse {
  status: number;
  data?: any;
  errors?: { message: string; extensions?: { code?: string } }[];
}

let server: ApolloServer<Context>;
let url: string;

async function gql(query: string, variables: Record<string, unknown>, userId?: string): Promise<GqlResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as Omit<GqlResponse, 'status'>;
  return { status: res.status, ...body };
}

async function sqlIds(where: string, params: unknown[]): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT t.id FROM tasks t WHERE ${where} ORDER BY t.created_at DESC, t.id DESC`,
    params,
  );
  return rows.map((row) => row.id);
}

async function statusId(projectId: string, name: string): Promise<string> {
  const { rows } = await pool.query('SELECT id FROM project_statuses WHERE project_id = $1 AND name = $2', [
    projectId,
    name,
  ]);
  return rows[0].id;
}

beforeAll(async () => {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM tasks WHERE project_id = $1', [PLATFORM]);
  if (rows[0].n !== 2500) throw new Error('Seed data missing: run `npm run migrate && npm run seed` first.');
  ({ server, url } = await startServer(0));
});

afterAll(async () => {
  await server?.stop();
  await pool.end();
});

describe('authentication', () => {
  it('rejects a request without x-user-id', async () => {
    const res = await gql(TASKS, { projectId: PLATFORM });
    expect(res.status).toBe(401);
    expect(res.errors?.[0].extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown user id', async () => {
    const res = await gql(TASKS, { projectId: PLATFORM }, '20000000-0000-4000-8000-0000000000ff');
    expect(res.status).toBe(401);
  });
});

describe('tenant isolation', () => {
  it('lists only projects from the caller organizations', async () => {
    const alice = await gql('{ projects { id } }', {}, ALICE);
    expect(alice.data.projects.map((p: { id: string }) => p.id).sort()).toEqual([PLATFORM, WEBSITE]);
    const sam = await gql('{ projects { id } }', {}, SAM);
    expect(sam.data.projects).toHaveLength(3);
  });

  it('returns NOT_FOUND for another tenant project, identical to a missing project', async () => {
    const otherTenant = await gql(TASKS, { projectId: MOBILE }, ALICE);
    const missing = await gql(TASKS, { projectId: '30000000-0000-4000-8000-0000000000ff' }, ALICE);
    expect(otherTenant.errors?.[0]).toMatchObject({ message: 'Project not found', extensions: { code: 'NOT_FOUND' } });
    expect(otherTenant.errors?.[0].message).toBe(missing.errors?.[0].message);
    expect(otherTenant.data).toBeNull();
  });

  it('applies the same check to the summary query', async () => {
    const res = await gql(SUMMARY, { projectId: MOBILE }, ALICE);
    expect(res.errors?.[0].extensions?.code).toBe('NOT_FOUND');
  });

  it('does not leak data when filtering by another tenant status id', async () => {
    const foreignStatus = await statusId(MOBILE, 'Open');
    const filter = { statusIds: [foreignStatus] };
    const tasks = await gql(TASKS, { projectId: PLATFORM, filter }, ALICE);
    const summary = await gql(SUMMARY, { projectId: PLATFORM, filter }, ALICE);
    expect(tasks.data.tasks.edges).toEqual([]);
    expect(summary.data.taskSummary.total).toBe(0);
  });

  it('lets a member of both organizations read both, and a viewer read their own', async () => {
    expect((await gql(TASKS, { projectId: MOBILE, first: 1 }, SAM)).data.tasks.edges).toHaveLength(1);
    expect((await gql(TASKS, { projectId: PLATFORM, first: 1 }, VICTOR)).data.tasks.edges).toHaveLength(1);
  });
});

describe('filters', () => {
  it('combines status, assignee, priority and due date range with AND', async () => {
    const inProgress = await statusId(PLATFORM, 'In Progress');
    const filter = {
      statusIds: [inProgress],
      assigneeIds: [ALICE, SAM],
      priorities: ['HIGH', 'URGENT'],
      dueFrom: '2000-01-01',
      dueTo: '2100-01-01',
    };
    const expected = await sqlIds(
      `t.project_id = $1 AND t.status_id = $2 AND t.assignee_id = ANY($3) AND t.priority IN ('high', 'urgent')
       AND t.due_date BETWEEN '2000-01-01' AND '2100-01-01'`,
      [PLATFORM, inProgress, [ALICE, SAM]],
    );
    expect(expected.length).toBeGreaterThan(0);

    const res = await gql(TASKS, { projectId: PLATFORM, filter, first: 100 }, ALICE);
    expect(res.data.tasks.edges.map((e: { node: { id: string } }) => e.node.id)).toEqual(expected.slice(0, 100));
    for (const { node } of res.data.tasks.edges) {
      expect(node.status.id).toBe(inProgress);
      expect([ALICE, SAM]).toContain(node.assignee.id);
      expect(['HIGH', 'URGENT']).toContain(node.priority);
    }
  });

  it('treats due date bounds as inclusive', async () => {
    const { rows } = await pool.query(
      `SELECT due_date FROM tasks WHERE project_id = $1 AND due_date IS NOT NULL LIMIT 1`,
      [PLATFORM],
    );
    const day: string = rows[0].due_date;
    const expected = await sqlIds('t.project_id = $1 AND t.due_date = $2', [PLATFORM, day]);
    const res = await gql(SUMMARY, { projectId: PLATFORM, filter: { dueFrom: day, dueTo: day } }, ALICE);
    expect(res.data.taskSummary.total).toBe(expected.length);
  });

  it('rejects malformed input as BAD_USER_INPUT instead of a server error', async () => {
    const cases = [
      { filter: { statusIds: ['not-a-uuid'] } },
      { filter: { dueFrom: '2026-02-30' } },
      { filter: { dueFrom: '2026-03-02', dueTo: '2026-03-01' } },
      { first: 0 },
      { first: 101 },
      { after: 'garbage' },
    ];
    for (const variables of cases) {
      const res = await gql(TASKS, { projectId: PLATFORM, ...variables }, ALICE);
      expect(res.errors?.[0].extensions?.code, JSON.stringify(variables)).toBe('BAD_USER_INPUT');
    }
  });
});

describe('cursor pagination', () => {
  it('walks all 2,500 tasks in order with no gaps or duplicates, across created_at ties', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM (SELECT created_at FROM tasks WHERE project_id = $1 GROUP BY created_at HAVING count(*) > 1) ties`,
      [PLATFORM],
    );
    expect(rows[0].n).toBeGreaterThan(0); // the seed must contain ties for this test to mean anything

    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const res: GqlResponse = await gql(TASKS, { projectId: PLATFORM, first: 100, after }, ALICE);
      const connection = res.data.tasks;
      seen.push(...connection.edges.map((e: { node: { id: string } }) => e.node.id));
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      pages += 1;
    } while (after);

    expect(pages).toBe(25);
    expect(seen).toEqual(await sqlIds('t.project_id = $1', [PLATFORM]));
  });

  it('reports no next page on the last page', async () => {
    const res = await gql(TASKS, { projectId: WEBSITE, first: 40 }, ALICE);
    expect(res.data.tasks.edges).toHaveLength(40);
    expect(res.data.tasks.pageInfo.hasNextPage).toBe(false);
  });
});

describe('summary', () => {
  it('matches independent SQL counts for totals, overdue and each breakdown', async () => {
    const res = await gql(SUMMARY, { projectId: PLATFORM }, ALICE);
    const summary = res.data.taskSummary;

    const q = async (sql: string) => (await pool.query(sql, [PLATFORM])).rows;
    const [{ total }] = await q('SELECT count(*)::int AS total FROM tasks WHERE project_id = $1');
    const [{ overdue }] = await q(
      `SELECT count(*)::int AS overdue FROM tasks t JOIN project_statuses s ON s.id = t.status_id
        WHERE t.project_id = $1 AND t.due_date < current_date AND s.category <> 'done'`,
    );
    const byStatus = await q(
      `SELECT s.id, count(t.id)::int AS n FROM project_statuses s LEFT JOIN tasks t ON t.status_id = s.id
        WHERE s.project_id = $1 GROUP BY s.id, s.position ORDER BY s.position`,
    );
    const byPriority = await q(
      'SELECT upper(priority) AS p, count(*)::int AS n FROM tasks WHERE project_id = $1 GROUP BY priority',
    );
    const byAssignee = await q(
      'SELECT assignee_id AS id, count(*)::int AS n FROM tasks WHERE project_id = $1 GROUP BY assignee_id',
    );

    expect(summary.total).toBe(total);
    expect(summary.overdue).toBe(overdue);
    expect(summary.overdue).toBeGreaterThan(0);
    expect(summary.byStatus.map((s: any) => [s.status.id, s.count])).toEqual(byStatus.map((r) => [r.id, r.n]));
    expect(summary.byPriority.map((p: any) => p.priority)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
    expect(Object.fromEntries(summary.byPriority.map((p: any) => [p.priority, p.count]))).toEqual(
      Object.fromEntries(byPriority.map((r) => [r.p, r.n])),
    );
    // Unassigned tasks appear with a null assignee.
    expect(new Map(summary.byAssignee.map((a: any) => [a.assignee?.id ?? null, a.count]))).toEqual(
      new Map(byAssignee.map((r) => [r.id, r.n])),
    );
  });

  it('applies the same filter as the task list and zero-fills every status and priority', async () => {
    const filter = { priorities: ['URGENT'] };
    const res = await gql(SUMMARY, { projectId: PLATFORM, filter }, ALICE);
    const expected = await sqlIds(`t.project_id = $1 AND t.priority = 'urgent'`, [PLATFORM]);
    const summary = res.data.taskSummary;
    expect(summary.total).toBe(expected.length);
    expect(summary.byStatus).toHaveLength(5);
    expect(summary.byPriority.filter((p: any) => p.count > 0)).toEqual([
      { priority: 'URGENT', count: expected.length },
    ]);
  });
});

describe('N+1 avoidance', () => {
  it('uses the same number of SQL queries for 10 tasks as for 100', async () => {
    const spy = vi.spyOn(pool, 'query');
    const countQueries = async (first: number) => {
      spy.mockClear();
      const res = await gql(TASKS, { projectId: PLATFORM, first }, ALICE);
      expect(res.data.tasks.edges).toHaveLength(first);
      return spy.mock.calls.length;
    };
    const small = await countQueries(10);
    const large = await countQueries(100);
    spy.mockRestore();
    // membership + project check + task page + one batched query each for status, assignee, labels
    expect(small).toBe(6);
    expect(large).toBe(6);
  });
});
