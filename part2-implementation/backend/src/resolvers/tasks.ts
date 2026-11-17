import { GraphQLError } from 'graphql';
import type { Context } from '../context';
import { decodeCursor, encodeCursor } from '../cursor';
import { pool } from '../db';
import { badInput, isIsoDate, isUuid } from '../validation';

const MAX_PAGE_SIZE = 100;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
type Priority = (typeof PRIORITIES)[number];

interface TaskFilter {
  statusIds?: string[] | null;
  assigneeIds?: string[] | null;
  priorities?: Priority[] | null;
  dueFrom?: string | null;
  dueTo?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  priority: Priority;
  status_id: string;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
}

interface SummaryRow {
  status_id: string | null;
  priority: Priority | null;
  assignee_id: string | null;
  grouping_set: number;
  total: number;
  overdue: number;
}

// GROUPING() sets one bit per column left out of the group: status=4, priority=2, assignee=1.
const BY_STATUS = 0b011;
const BY_PRIORITY = 0b101;
const BY_ASSIGNEE = 0b110;
const GRAND_TOTAL = 0b111;

export const taskResolvers = {
  Query: {
    async tasks(
      _parent: unknown,
      args: { projectId: string; filter?: TaskFilter | null; first: number; after?: string | null },
      ctx: Context,
    ) {
      if (!Number.isInteger(args.first) || args.first < 1 || args.first > MAX_PAGE_SIZE) {
        throw badInput(`first must be between 1 and ${MAX_PAGE_SIZE}`);
      }
      validateFilter(args.filter);
      const cursor = args.after ? decodeCursor(args.after) : null;
      await assertProjectVisible(ctx, args.projectId);

      const { conditions, params } = taskConditions(args.projectId, ctx.orgIds, args.filter);
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        // Row comparison in index order, so the cursor is an index condition, not a filter.
        conditions.push(`(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      // One extra row answers hasNextPage without a COUNT.
      params.push(args.first + 1);

      const { rows } = await pool.query<TaskRow>(
        `SELECT t.id, t.title, t.priority, t.status_id, t.assignee_id, t.due_date,
                to_json(t.created_at) #>> '{}' AS created_at
           FROM tasks t
          WHERE ${conditions.join(' AND ')}
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT $${params.length}`,
        params,
      );

      const page = rows.slice(0, args.first);
      const edges = page.map((row) => ({ cursor: encodeCursor({ createdAt: row.created_at, id: row.id }), node: row }));
      return {
        edges,
        pageInfo: { endCursor: edges.at(-1)?.cursor ?? null, hasNextPage: rows.length > args.first },
      };
    },

    async taskSummary(_parent: unknown, args: { projectId: string; filter?: TaskFilter | null }, ctx: Context) {
      validateFilter(args.filter);
      await assertProjectVisible(ctx, args.projectId);

      const { conditions, params } = taskConditions(args.projectId, ctx.orgIds, args.filter);
      // One pass produces all three breakdowns and the totals.
      const { rows } = await pool.query<SummaryRow>(
        `SELECT t.status_id, t.priority, t.assignee_id,
                GROUPING(t.status_id, t.priority, t.assignee_id) AS grouping_set,
                count(*)::int AS total,
                (count(*) FILTER (WHERE t.due_date < current_date AND s.category <> 'done'))::int AS overdue
           FROM tasks t
           JOIN project_statuses s ON s.id = t.status_id
          WHERE ${conditions.join(' AND ')}
          GROUP BY GROUPING SETS ((t.status_id), (t.priority), (t.assignee_id), ())`,
        params,
      );

      const grandTotal = rows.find((row) => row.grouping_set === GRAND_TOTAL);
      const countsFor = (set: number, key: (row: SummaryRow) => string | null) =>
        new Map(rows.filter((row) => row.grouping_set === set).map((row) => [key(row), row.total]));
      const statusCounts = countsFor(BY_STATUS, (row) => row.status_id);
      const priorityCounts = countsFor(BY_PRIORITY, (row) => row.priority);

      // Zero-filled so charts show every status and priority.
      const statuses = await ctx.loaders.statusesByProject.load(args.projectId);
      return {
        total: grandTotal?.total ?? 0,
        overdue: grandTotal?.overdue ?? 0,
        byStatus: statuses.map((status) => ({ status, count: statusCounts.get(status.id) ?? 0 })),
        byPriority: PRIORITIES.map((priority) => ({ priority, count: priorityCounts.get(priority) ?? 0 })),
        byAssignee: rows
          .filter((row) => row.grouping_set === BY_ASSIGNEE)
          .map((row) => ({ assigneeId: row.assignee_id, count: row.total }))
          .sort((a, b) => b.count - a.count),
      };
    },
  },

  Task: {
    status: (task: TaskRow, _args: unknown, ctx: Context) => ctx.loaders.status.load(task.status_id),
    assignee: (task: TaskRow, _args: unknown, ctx: Context) =>
      task.assignee_id ? ctx.loaders.user.load(task.assignee_id) : null,
    labels: (task: TaskRow, _args: unknown, ctx: Context) => ctx.loaders.labelsByTask.load(task.id),
    dueDate: (task: TaskRow) => task.due_date,
    createdAt: (task: TaskRow) => task.created_at,
  },

  AssigneeCount: {
    assignee: (row: { assigneeId: string | null }, _args: unknown, ctx: Context) =>
      row.assigneeId ? ctx.loaders.user.load(row.assigneeId) : null,
  },

  // GraphQL enum names to the lowercase values stored in the database.
  Priority: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', URGENT: 'urgent' },
  StatusCategory: { TODO: 'todo', IN_PROGRESS: 'in_progress', DONE: 'done' },
};

// Another tenant's project gets the same NOT_FOUND as a missing one, so its existence never leaks.
async function assertProjectVisible(ctx: Context, projectId: string): Promise<void> {
  const visible =
    isUuid(projectId) &&
    (await pool.query('SELECT 1 FROM projects WHERE id = $1 AND org_id = ANY($2)', [projectId, ctx.orgIds]))
      .rowCount === 1;
  if (!visible) {
    throw new GraphQLError('Project not found', { extensions: { code: 'NOT_FOUND' } });
  }
}

function validateFilter(filter: TaskFilter | null | undefined): void {
  const ids = [...(filter?.statusIds ?? []), ...(filter?.assigneeIds ?? [])];
  if (!ids.every(isUuid)) throw badInput('statusIds and assigneeIds must be UUIDs');
  for (const date of [filter?.dueFrom, filter?.dueTo]) {
    if (date && !isIsoDate(date)) throw badInput(`Invalid date "${date}", expected YYYY-MM-DD`);
  }
  if (filter?.dueFrom && filter?.dueTo && filter.dueFrom > filter.dueTo) {
    throw badInput('dueFrom must not be after dueTo');
  }
}

// Shared by tasks and taskSummary so both count the same rows. Only set filters add a predicate;
// the tenant condition is always present.
function taskConditions(projectId: string, orgIds: string[], filter: TaskFilter | null | undefined) {
  const params: unknown[] = [projectId, orgIds];
  const conditions = ['t.project_id = $1', 't.org_id = ANY($2)'];
  const add = (predicate: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(predicate(`$${params.length}`));
  };

  if (filter?.statusIds?.length) add((p) => `t.status_id = ANY(${p}::uuid[])`, filter.statusIds);
  if (filter?.assigneeIds?.length) add((p) => `t.assignee_id = ANY(${p}::uuid[])`, filter.assigneeIds);
  if (filter?.priorities?.length) add((p) => `t.priority = ANY(${p}::text[])`, filter.priorities);
  if (filter?.dueFrom) add((p) => `t.due_date >= ${p}::date`, filter.dueFrom);
  if (filter?.dueTo) add((p) => `t.due_date <= ${p}::date`, filter.dueTo);
  return { conditions, params };
}
