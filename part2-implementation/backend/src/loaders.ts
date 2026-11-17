import DataLoader from 'dataloader';
import { pool } from './db';

interface User {
  id: string;
  name: string;
}

interface Status {
  id: string;
  name: string;
  category: 'todo' | 'in_progress' | 'done';
  position: number;
}

interface Label {
  id: string;
  name: string;
}

export type Loaders = ReturnType<typeof createLoaders>;

// Created per request, so caching never crosses users. Each loader also filters by the caller's
// organizations, so a foreign key resolves to null instead of another tenant's data.
export function createLoaders(orgIds: string[]) {
  return {
    user: new DataLoader<string, User | null>(async (ids) => {
      const { rows } = await pool.query<User>(
        `SELECT DISTINCT u.id, u.name
           FROM users u
           JOIN organization_members m ON m.user_id = u.id
          WHERE u.id = ANY($1) AND m.org_id = ANY($2)`,
        [ids, orgIds],
      );
      return byKey(ids, rows, (row) => row.id);
    }),

    status: new DataLoader<string, Status | null>(async (ids) => {
      const { rows } = await pool.query<Status>(
        `SELECT id, name, category, position
           FROM project_statuses
          WHERE id = ANY($1) AND org_id = ANY($2)`,
        [ids, orgIds],
      );
      return byKey(ids, rows, (row) => row.id);
    }),

    labelsByTask: new DataLoader<string, Label[]>(async (taskIds) => {
      const { rows } = await pool.query<Label & { task_id: string }>(
        `SELECT tl.task_id, l.id, l.name
           FROM task_labels tl
           JOIN labels l ON l.id = tl.label_id
          WHERE tl.task_id = ANY($1) AND tl.org_id = ANY($2)
          ORDER BY l.name`,
        [taskIds, orgIds],
      );
      return groupByKey(taskIds, rows, ({ task_id, ...label }) => [task_id, label]);
    }),

    statusesByProject: new DataLoader<string, Status[]>(async (projectIds) => {
      const { rows } = await pool.query<Status & { project_id: string }>(
        `SELECT project_id, id, name, category, position
           FROM project_statuses
          WHERE project_id = ANY($1) AND org_id = ANY($2)
          ORDER BY position`,
        [projectIds, orgIds],
      );
      return groupByKey(projectIds, rows, ({ project_id, ...status }) => [project_id, status]);
    }),

    membersByOrg: new DataLoader<string, User[]>(async (memberOrgIds) => {
      const { rows } = await pool.query<User & { org_id: string }>(
        `SELECT m.org_id, u.id, u.name
           FROM organization_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ANY($1) AND m.org_id = ANY($2)
          ORDER BY u.name`,
        [memberOrgIds, orgIds],
      );
      return groupByKey(memberOrgIds, rows, ({ org_id, ...user }) => [org_id, user]);
    }),
  };
}

// DataLoader needs one result per key, in key order.
function byKey<T>(keys: readonly string[], rows: T[], keyOf: (row: T) => string): (T | null)[] {
  const map = new Map(rows.map((row) => [keyOf(row), row]));
  return keys.map((key) => map.get(key) ?? null);
}

function groupByKey<R, T>(keys: readonly string[], rows: R[], split: (row: R) => [string, T]): T[][] {
  const groups = new Map<string, T[]>(keys.map((key) => [key, []]));
  for (const row of rows) {
    const [key, value] = split(row);
    groups.get(key)?.push(value);
  }
  return keys.map((key) => groups.get(key) ?? []);
}
