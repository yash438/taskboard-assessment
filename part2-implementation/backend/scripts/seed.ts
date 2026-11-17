import { pool } from '../src/db';

// Fixed IDs for x-user-id and tests. Alice (Acme only) vs Globex is the cross-tenant case;
// Sam belongs to both organizations; Victor is a viewer.
const ORG = { acme: '10000000-0000-4000-8000-000000000001', globex: '10000000-0000-4000-8000-000000000002' };
const USERS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Alice Owner',
    email: 'alice@acme.test',
    orgs: { acme: 'owner' },
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Arjun Admin',
    email: 'arjun@acme.test',
    orgs: { acme: 'admin' },
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'Maya Member',
    email: 'maya@acme.test',
    orgs: { acme: 'member' },
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    name: 'Victor Viewer',
    email: 'victor@acme.test',
    orgs: { acme: 'viewer' },
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    name: 'Bianca Owner',
    email: 'bianca@globex.test',
    orgs: { globex: 'owner' },
  },
  {
    id: '20000000-0000-4000-8000-000000000006',
    name: 'Ben Member',
    email: 'ben@globex.test',
    orgs: { globex: 'member' },
  },
  {
    id: '20000000-0000-4000-8000-000000000007',
    name: 'Sam Both',
    email: 'sam@both.test',
    orgs: { acme: 'member', globex: 'member' },
  },
] as const;
// Platform matches the 2,000+ task scenario in the Part 3 RFC.
const PROJECTS = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    org: 'acme',
    name: 'Platform',
    tasks: 2500,
    statuses: [
      ['Backlog', 'todo'],
      ['Todo', 'todo'],
      ['In Progress', 'in_progress'],
      ['In Review', 'in_progress'],
      ['Done', 'done'],
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    org: 'acme',
    name: 'Website',
    tasks: 40,
    statuses: [
      ['To do', 'todo'],
      ['Doing', 'in_progress'],
      ['Shipped', 'done'],
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    org: 'globex',
    name: 'Mobile App',
    tasks: 120,
    statuses: [
      ['Open', 'todo'],
      ['In Progress', 'in_progress'],
      ['Closed', 'done'],
    ],
  },
] as const;
const LABELS = ['bug', 'feature', 'chore', 'design'];

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-runnable, and the same data every run.
    await client.query('TRUNCATE organizations, users RESTART IDENTITY CASCADE');
    await client.query('SELECT setseed(0.42)');

    await client.query(
      `INSERT INTO organizations (id, name, slug, settings)
       VALUES ($1, 'Acme', 'acme', '{"weekStartsOn": "monday"}'), ($2, 'Globex', 'globex', '{}')`,
      [ORG.acme, ORG.globex],
    );
    await client.query(`INSERT INTO users (id, name, email) SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])`, [
      USERS.map((u) => u.id),
      USERS.map((u) => u.name),
      USERS.map((u) => u.email),
    ]);
    const memberships = USERS.flatMap((u) =>
      Object.entries(u.orgs).map(([org, role]) => [ORG[org as keyof typeof ORG], u.id, role]),
    );
    await client.query(
      `INSERT INTO organization_members (org_id, user_id, role) SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])`,
      [memberships.map((m) => m[0]), memberships.map((m) => m[1]), memberships.map((m) => m[2])],
    );
    await client.query(
      `INSERT INTO projects (id, org_id, name) SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])`,
      [PROJECTS.map((p) => p.id), PROJECTS.map((p) => ORG[p.org]), PROJECTS.map((p) => p.name)],
    );
    const statuses = PROJECTS.flatMap((p) =>
      p.statuses.map(([name, category], i) => [ORG[p.org], p.id, name, category, i + 1]),
    );
    await client.query(
      `INSERT INTO project_statuses (org_id, project_id, name, category, position)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::int[])`,
      [0, 1, 2, 3, 4].map((col) => statuses.map((s) => s[col])),
    );
    await client.query(
      `INSERT INTO labels (org_id, name) SELECT o.id, l FROM organizations o CROSS JOIN unnest($1::text[]) l`,
      [LABELS],
    );

    // Set-based: random status, non-viewer assignee (10% none), due date within ±60 days (15% none).
    // Every three tasks share a created_at, which exercises the pagination tiebreaker.
    await client.query(
      `INSERT INTO tasks (org_id, project_id, status_id, title, priority, assignee_id, due_date, created_at)
       SELECT p.org_id, p.id,
              st.ids[1 + floor(random() * cardinality(st.ids))::int],
              (ARRAY['Fix', 'Add', 'Refactor', 'Update', 'Investigate', 'Document'])[1 + floor(random() * 6)::int] || ' ' ||
              (ARRAY['login flow', 'billing page', 'search API', 'export job', 'notifications', 'dashboard', 'permissions', 'onboarding'])[1 + floor(random() * 8)::int] ||
              ' #' || g,
              (ARRAY['low', 'medium', 'medium', 'medium', 'high', 'high', 'urgent'])[1 + floor(random() * 7)::int],
              CASE WHEN random() < 0.1 THEN NULL ELSE mb.ids[1 + floor(random() * cardinality(mb.ids))::int] END,
              CASE WHEN random() < 0.15 THEN NULL ELSE current_date + (floor(random() * 121) - 60)::int END,
              date_trunc('minute', now()) - make_interval(mins => (g / 3) * 7)
         FROM projects p
         JOIN unnest($1::uuid[], $2::int[]) AS cfg(project_id, task_count) ON cfg.project_id = p.id
         CROSS JOIN LATERAL (SELECT array_agg(id ORDER BY position) AS ids FROM project_statuses WHERE project_id = p.id) st
         CROSS JOIN LATERAL (SELECT array_agg(user_id ORDER BY user_id) AS ids FROM organization_members
                              WHERE org_id = p.org_id AND role <> 'viewer') mb
         CROSS JOIN LATERAL generate_series(1, cfg.task_count) g`,
      [PROJECTS.map((p) => p.id), PROJECTS.map((p) => p.tasks)],
    );
    // Roughly 0-2 labels per task.
    await client.query(
      `INSERT INTO task_labels (org_id, task_id, label_id)
       SELECT t.org_id, t.id, l.id FROM tasks t JOIN labels l ON l.org_id = t.org_id WHERE random() < 0.3`,
    );
    await client.query('COMMIT');

    const { rows } = await client.query(
      `SELECT p.name AS project, o.name AS org, count(t.id)::int AS tasks
         FROM projects p JOIN organizations o ON o.id = p.org_id LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.name, o.name ORDER BY o.name, p.name`,
    );
    console.table(rows);
    console.table(USERS.map((u) => ({ name: u.name, 'x-user-id': u.id, roles: JSON.stringify(u.orgs) })));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
