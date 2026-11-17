import { useQuery } from '@apollo/client';
import { useState } from 'react';
import { ErrorMessage } from './components/ErrorMessage';
import { TaskBoard } from './components/TaskBoard/TaskBoard';
import { PROJECTS_QUERY, type ProjectsData } from './graphql/queries';

export function App() {
  const { data, loading, error, refetch } = useQuery<ProjectsData>(PROJECTS_QUERY);
  const [selectedId, setSelectedId] = useState<string>();
  const projects = data?.projects ?? [];
  const project = projects.find((p) => p.id === selectedId) ?? projects[0];

  let content;
  if (error) {
    content = <ErrorMessage error={error} onRetry={() => void refetch().catch(() => undefined)} />;
  } else if (loading) {
    content = <p className="muted">Loading projects…</p>;
  } else if (!project) {
    content = <div className="empty">You are not a member of any organization with projects.</div>;
  } else {
    // Keyed by project so switching projects starts with fresh filters.
    content = <TaskBoard key={project.id} project={project} />;
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Task Board</h1>
        {projects.length > 0 && (
          <label>
            Project
            <select value={project?.id} onChange={(event) => setSelectedId(event.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {content}
    </main>
  );
}
