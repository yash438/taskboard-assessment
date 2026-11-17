import { PRIORITIES, type Priority, type Project } from '../../graphql/queries';
import type { FilterValues } from './filters';
import { priorityLabel } from './format';

interface FilterBarProps {
  project: Project;
  values: FilterValues;
  filtersActive: boolean;
  onChange: (values: FilterValues) => void;
  onClear: () => void;
}

export function FilterBar({ project, values, filtersActive, onChange, onClear }: FilterBarProps) {
  const set = <K extends keyof FilterValues>(key: K, value: FilterValues[K]) => onChange({ ...values, [key]: value });

  return (
    <form className="filters" aria-label="Task filters" onSubmit={(event) => event.preventDefault()}>
      <label>
        Status
        <select value={values.statusId} onChange={(event) => set('statusId', event.target.value)}>
          <option value="">All</option>
          {project.statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select value={values.assigneeId} onChange={(event) => set('assigneeId', event.target.value)}>
          <option value="">All</option>
          {project.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={values.priority} onChange={(event) => set('priority', event.target.value as Priority | '')}>
          <option value="">All</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priorityLabel(priority)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due from
        <input
          type="date"
          value={values.dueFrom}
          max={values.dueTo || undefined}
          onChange={(event) => set('dueFrom', event.target.value)}
        />
      </label>
      <label>
        Due to
        <input
          type="date"
          value={values.dueTo}
          min={values.dueFrom || undefined}
          onChange={(event) => set('dueTo', event.target.value)}
        />
      </label>
      <button type="button" onClick={onClear} disabled={!filtersActive}>
        Clear filters
      </button>
    </form>
  );
}
