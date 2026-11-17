import type { Priority } from '../../graphql/queries';

// URGENT -> Urgent
export function priorityLabel(priority: Priority): string {
  return priority.charAt(0) + priority.slice(1).toLowerCase();
}
