import { readFileSync } from 'node:fs';
import { ApolloServer } from '@apollo/server';
import { ApolloServerErrorCode, unwrapResolverError } from '@apollo/server/errors';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildContext, type Context } from './context';
import { projectResolvers } from './resolvers/projects';
import { taskResolvers } from './resolvers/tasks';

const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');

export async function startServer(port: number): Promise<{ server: ApolloServer<Context>; url: string }> {
  const server = new ApolloServer<Context>({
    typeDefs,
    resolvers: [taskResolvers, projectResolvers],
    // Apollo's default depends on NODE_ENV, and this server never runs in production.
    includeStacktraceInErrorResponses: false,
    // Unexpected errors are logged, not returned, so SQL and internals never reach the client.
    formatError: (formatted, error) => {
      if (formatted.extensions?.code !== ApolloServerErrorCode.INTERNAL_SERVER_ERROR) return formatted;
      console.error(unwrapResolverError(error));
      return { message: 'Internal server error', extensions: { code: ApolloServerErrorCode.INTERNAL_SERVER_ERROR } };
    },
  });
  const { url } = await startStandaloneServer(server, {
    listen: { port },
    context: async ({ req }) => buildContext(req.headers['x-user-id']),
  });
  return { server, url };
}
