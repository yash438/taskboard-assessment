import { GraphQLError } from 'graphql';
import { pool } from './db';
import { createLoaders, type Loaders } from './loaders';
import { isUuid } from './validation';

export interface Context {
  userId: string;
  orgIds: string[]; // scopes every query and loader
  loaders: Loaders;
}

// Dev stand-in for authentication: the header names the user, memberships come from the database.
export async function buildContext(userIdHeader: string | string[] | undefined): Promise<Context> {
  const userId = typeof userIdHeader === 'string' ? userIdHeader : '';
  if (!isUuid(userId)) throw unauthenticated();

  const { rows } = await pool.query<{ org_id: string | null }>(
    `SELECT m.org_id
       FROM users u
       LEFT JOIN organization_members m ON m.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) throw unauthenticated();

  // A user with no memberships is valid and sees nothing.
  const orgIds = rows.flatMap((row) => (row.org_id ? [row.org_id] : []));
  return { userId, orgIds, loaders: createLoaders(orgIds) };
}

function unauthenticated(): GraphQLError {
  return new GraphQLError('Missing or unknown x-user-id header', {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
  });
}
