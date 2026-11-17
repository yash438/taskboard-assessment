import type { Context } from '../context';
import { pool } from '../db';

interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
}

// The board's project picker and filter options.
export const projectResolvers = {
  Query: {
    async projects(_parent: unknown, _args: unknown, ctx: Context) {
      const { rows } = await pool.query<ProjectRow>(
        `SELECT id, org_id, name
           FROM projects
          WHERE org_id = ANY($1) AND archived_at IS NULL
          ORDER BY name`,
        [ctx.orgIds],
      );
      return rows;
    },
  },

  Project: {
    statuses: (project: ProjectRow, _args: unknown, ctx: Context) => ctx.loaders.statusesByProject.load(project.id),
    members: (project: ProjectRow, _args: unknown, ctx: Context) => ctx.loaders.membersByOrg.load(project.org_id),
  },
};
