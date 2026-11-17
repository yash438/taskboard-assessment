import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import type { TasksData } from './queries';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/';

export const client = new ApolloClient({
  link: new HttpLink({
    uri: API_URL,
    // Dev stand-in for authentication.
    headers: { 'x-user-id': import.meta.env.VITE_USER_ID ?? '' },
  }),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          tasks: {
            // One list per project and filter; the cursor is not part of the key.
            keyArgs: ['projectId', 'filter'],
            // Append pages; a request without a cursor replaces the list.
            merge(existing: TasksData['tasks'] | undefined, incoming: TasksData['tasks'], { args }) {
              if (!args?.after || !existing) return incoming;
              return { ...incoming, edges: [...existing.edges, ...incoming.edges] };
            },
          },
        },
      },
    },
  }),
});
