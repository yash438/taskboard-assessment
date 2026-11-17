import type { ApolloError } from '@apollo/client';
import { API_URL } from '../graphql/client';

// Actionable messages instead of raw error text.
function describeError(error: Error): string {
  const apollo = error as Partial<ApolloError>;
  const graphQLError = apollo.graphQLErrors?.[0];
  const httpStatus = (apollo.networkError as { statusCode?: number } | null | undefined)?.statusCode;

  if (graphQLError?.extensions?.code === 'UNAUTHENTICATED' || httpStatus === 401) {
    return 'The API did not recognise the dev user. Set VITE_USER_ID in the root .env to a seeded user id.';
  }
  if (graphQLError?.extensions?.code === 'NOT_FOUND') {
    return 'This project does not exist or you do not have access to it.';
  }
  if (graphQLError?.extensions?.code === 'BAD_USER_INPUT') return graphQLError.message;
  if (apollo.networkError) return `Cannot reach the API at ${API_URL}. Is it running (npm run dev:api)?`;
  return 'Something went wrong while loading data.';
}

export function ErrorMessage({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      <span>{describeError(error)}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
