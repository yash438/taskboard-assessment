import type { TaskSummary } from '../../graphql/queries';
import { ErrorMessage } from '../ErrorMessage';
import { PriorityChart } from './PriorityChart';

interface SummaryStatsProps {
  summary: TaskSummary | undefined;
  error: Error | undefined;
  onRetry: () => void;
}

// Independent of the table, so a slow or failed summary never blocks the list.
export function SummaryStats({ summary, error, onRetry }: SummaryStatsProps) {
  if (error && !summary) {
    return (
      <section className="summary" aria-label="Summary">
        <ErrorMessage error={error} onRetry={onRetry} />
      </section>
    );
  }
  if (!summary) {
    return (
      <section className="summary" aria-label="Summary">
        <p className="muted">Loading summary…</p>
      </section>
    );
  }

  return (
    <section className="summary" aria-label="Summary">
      <div className="stat">
        <span className="stat-label">Total tasks</span>
        <span className="stat-value">{summary.total.toLocaleString()}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Overdue</span>
        <span className="stat-value">{summary.overdue.toLocaleString()}</span>
        <span className="stat-hint">Past due date and not done</span>
      </div>
      <div className="stat chart">
        <span className="stat-label">Tasks by priority</span>
        <PriorityChart data={summary.byPriority} />
      </div>
    </section>
  );
}
