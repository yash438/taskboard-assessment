import { gql } from '@apollo/client';

// Hand-written types mirroring the backend schema.graphql.

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface User {
  id: string;
  name: string;
}

export interface ProjectStatus {
  id: string;
  name: string;
  category: 'TODO' | 'IN_PROGRESS' | 'DONE';
}

export interface Project {
  id: string;
  name: string;
  statuses: ProjectStatus[];
  members: User[];
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  status: ProjectStatus;
  assignee: User | null;
  labels: { id: string; name: string }[];
}

export interface TaskFilter {
  statusIds?: string[];
  assigneeIds?: string[];
  priorities?: Priority[];
  dueFrom?: string;
  dueTo?: string;
}

export interface TaskSummary {
  total: number;
  overdue: number;
  byPriority: { priority: Priority; count: number }[];
}

export interface ProjectsData {
  projects: Project[];
}

export interface TasksData {
  tasks: {
    edges: { cursor: string; node: Task }[];
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
  };
}

export interface TasksVariables {
  projectId: string;
  filter: TaskFilter;
  first: number;
  after?: string | null;
}

export interface TaskSummaryData {
  taskSummary: TaskSummary;
}

export interface TaskSummaryVariables {
  projectId: string;
  filter: TaskFilter;
}

export const PROJECTS_QUERY = gql`
  query Projects {
    projects {
      id
      name
      statuses {
        id
        name
        category
      }
      members {
        id
        name
      }
    }
  }
`;

export const TASKS_QUERY = gql`
  query Tasks($projectId: ID!, $filter: TaskFilter, $first: Int, $after: String) {
    tasks(projectId: $projectId, filter: $filter, first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          priority
          dueDate
          status {
            id
            name
            category
          }
          assignee {
            id
            name
          }
          labels {
            id
            name
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

export const TASK_SUMMARY_QUERY = gql`
  query TaskSummary($projectId: ID!, $filter: TaskFilter) {
    taskSummary(projectId: $projectId, filter: $filter) {
      total
      overdue
      byPriority {
        priority
        count
      }
    }
  }
`;
