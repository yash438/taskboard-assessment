import { useMemo, useState } from 'react';
import type { Project } from '../../graphql/queries';
import { useTasks } from '../../hooks/useTasks';
import { useTaskSummary } from '../../hooks/useTaskSummary';
import { ErrorMessage } from '../ErrorMessage';
import { FilterBar } from './FilterBar';
import { EMPTY_FILTERS, toTaskFilter } from './filters';
import { SummaryStats } from './SummaryStats';
import { TaskTable } from './TaskTable';

// Owns the filter state; the table and the summary share one filter, so the stats match the rows.
export function TaskBoard({ project }: { project: Project }) {
  const [values, setValues] = useState(EMPTY_FILTERS);
  // Stable variables, so Apollo does not refetch on unrelated renders.
  const filter = useMemo(() => toTaskFilter(values), [values]);
  const filtersActive = Object.keys(filter).length > 0;

  const tasks = useTasks(project.id, filter);
  const summary = useTaskSummary(project.id, filter);
  const clearFilters = () => setValues(EMPTY_FILTERS);

  // A failed refetch shows through the hook's error state.
  const retry = (refetch: () => Promise<unknown>) => () => void refetch().catch(() => undefined);

  let table;
  if (tasks.error && tasks.tasks.length === 0) {
    table = <ErrorMessage error={tasks.error} onRetry={retry(tasks.refetch)} />;
  } else if (tasks.loading && tasks.tasks.length === 0) {
    table = <p className="muted">Loading tasks…</p>;
  } else {
    table = (
      <TaskTable
        tasks={tasks.tasks}
        total={summary.summary?.total}
        hasNextPage={tasks.hasNextPage}
        loadingMore={tasks.loadingMore}
        loadMoreError={tasks.loadMoreError}
        filtersActive={filtersActive}
        onLoadMore={tasks.loadMore}
        onClearFilters={clearFilters}
      />
    );
  }

  return (
    <>
      <FilterBar
        project={project}
        values={values}
        filtersActive={filtersActive}
        onChange={setValues}
        onClear={clearFilters}
      />
      <SummaryStats summary={summary.summary} error={summary.error} onRetry={retry(summary.refetch)} />
      <section aria-label="Tasks">{table}</section>
    </>
  );
}
