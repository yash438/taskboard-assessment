import { useQuery } from '@apollo/client';
import {
  TASK_SUMMARY_QUERY,
  type TaskFilter,
  type TaskSummaryData,
  type TaskSummaryVariables,
} from '../graphql/queries';

// Totals come from the API: the table only holds the pages loaded so far.
export function useTaskSummary(projectId: string, filter: TaskFilter) {
  const { data, error, refetch } = useQuery<TaskSummaryData, TaskSummaryVariables>(TASK_SUMMARY_QUERY, {
    variables: { projectId, filter },
  });
  return { summary: data?.taskSummary, error, refetch };
}
