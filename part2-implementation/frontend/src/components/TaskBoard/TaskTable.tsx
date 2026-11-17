import type { Task } from '../../graphql/queries';
import { ErrorMessage } from '../ErrorMessage';
import { priorityLabel } from './format';

interface TaskTableProps {
  tasks: Task[];
  total: number | undefined;
  hasNextPage: boolean;
  loadingMore: boolean;
  loadMoreError: Error | null;
  filtersActive: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
}

export function TaskTable(props: TaskTableProps) {
  const { tasks, total, hasNextPage, loadingMore, loadMoreError, filtersActive, onLoadMore, onClearFilters } = props;

  // An empty project and a too-narrow filter need different next steps.
  if (tasks.length === 0) {
    return filtersActive ? (
      <div className="empty">
        <p>No tasks match these filters.</p>
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      </div>
    ) : (
      <div className="empty">
        <p>This project has no tasks yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="tasks">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due</th>
              <th scope="col">Labels</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td>{task.status.name}</td>
                <td>
                  <span className={`priority priority-${task.priority.toLowerCase()}`}>
                    {priorityLabel(task.priority)}
                  </span>
                </td>
                <td>{task.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                <td className="nowrap">{task.dueDate ?? <span className="muted">None</span>}</td>
                <td>
                  {task.labels.map((label) => (
                    <span key={label.id} className="label">
                      {label.name}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        <span className="muted">
          Showing {tasks.length.toLocaleString()}
          {total !== undefined && ` of ${total.toLocaleString()}`} tasks
        </span>
        {/* A failed page keeps the rows already loaded; only the next page is retried. */}
        {loadMoreError ? (
          <ErrorMessage error={loadMoreError} onRetry={onLoadMore} />
        ) : (
          hasNextPage && (
            <button type="button" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )
        )}
      </div>
    </>
  );
}
