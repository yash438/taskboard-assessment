import type { Priority, TaskFilter } from '../../graphql/queries';

// Form values; an empty string means "All".
export interface FilterValues {
  statusId: string;
  assigneeId: string;
  priority: Priority | '';
  dueFrom: string;
  dueTo: string;
}

export const EMPTY_FILTERS: FilterValues = { statusId: '', assigneeId: '', priority: '', dueFrom: '', dueTo: '' };

// Only set controls become keys, so "no filters" is {} and shares one cache entry.
export function toTaskFilter(values: FilterValues): TaskFilter {
  const filter: TaskFilter = {};
  if (values.statusId) filter.statusIds = [values.statusId];
  if (values.assigneeId) filter.assigneeIds = [values.assigneeId];
  if (values.priority) filter.priorities = [values.priority];
  if (values.dueFrom) filter.dueFrom = values.dueFrom;
  if (values.dueTo) filter.dueTo = values.dueTo;
  return filter;
}
