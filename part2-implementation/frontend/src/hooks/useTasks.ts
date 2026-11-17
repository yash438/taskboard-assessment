import { useQuery } from '@apollo/client';
import { useCallback, useEffect, useState } from 'react';
import { TASKS_QUERY, type TaskFilter, type TasksData, type TasksVariables } from '../graphql/queries';

const PAGE_SIZE = 50;

// Paginated tasks. A failed "load more" is tracked separately so loaded rows stay on screen.
export function useTasks(projectId: string, filter: TaskFilter) {
  const { data, loading, error, fetchMore, refetch } = useQuery<TasksData, TasksVariables>(TASKS_QUERY, {
    variables: { projectId, filter, first: PAGE_SIZE },
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  // A new project or filter is a new list.
  useEffect(() => setLoadMoreError(null), [projectId, filter]);

  const pageInfo = data?.tasks.pageInfo;
  const loadMore = useCallback(async () => {
    if (!pageInfo?.hasNextPage || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      await fetchMore({ variables: { after: pageInfo.endCursor } });
    } catch (err) {
      setLoadMoreError(err as Error);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchMore, pageInfo, loadingMore]);

  return {
    tasks: data?.tasks.edges.map((edge) => edge.node) ?? [],
    hasNextPage: pageInfo?.hasNextPage ?? false,
    loading,
    error,
    refetch,
    loadMore,
    loadingMore,
    loadMoreError,
  };
}
