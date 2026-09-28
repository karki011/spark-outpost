import { useId, useState } from 'react';
import type { McpEnableRequest, Project, UserMcpServer } from '@spark-outpost/contracts';
import { SetupSwitch } from '../../chat/project/SetupCard.tsx';

interface McpProjectOverridesProps {
  server: UserMcpServer;
  projects: readonly Project[];
  busy: boolean;
  onChange: (body: McpEnableRequest) => void;
}

export function McpProjectOverrides({
  server,
  projects,
  busy,
  onChange,
}: McpProjectOverridesProps) {
  const selectId = useId();
  const [picked, setPicked] = useState('');
  const nameOf = (id: string) =>
    projects.find((project) => project.id === id)?.name ?? 'Removed project';
  const free = projects.filter(
    (project) => !server.projects.some((row) => row.projectId === project.id),
  );
  const set = (projectId: string, enabled: boolean | null) =>
    onChange(
      enabled
        ? { scope: 'project', scopeId: projectId, enabled: true, fingerprint: server.fingerprint }
        : { scope: 'project', scopeId: projectId, enabled },
    );

  return (
    <div className="mcp-projects">
      {server.projects.length > 0 && (
        <ul aria-label={`Project settings for ${server.name}`}>
          {server.projects.map((row) => (
            <li key={row.projectId}>
              <span>
                {nameOf(row.projectId)}
                {row.changed && <small className="mcp-bad"> changed, review it</small>}
              </span>
              <SetupSwitch
                label={`Use ${server.name} in ${nameOf(row.projectId)}`}
                checked={row.enabled}
                disabled={busy}
                onChange={(checked) => set(row.projectId, checked)}
              />
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => set(row.projectId, null)}
              >
                Use the all-chats setting
              </button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <div className="mcp-project-add">
          <label htmlFor={selectId}>Different in a project</label>
          <select
            id={selectId}
            className="inp"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
          >
            <option value="">Choose a project</option>
            {free.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn line sm"
            disabled={!picked || busy}
            onClick={() => {
              set(picked, !(server.global?.enabled ?? false));
              setPicked('');
            }}
          >
            {server.global?.enabled ? 'Turn off there' : 'Turn on there'}
          </button>
        </div>
      )}
    </div>
  );
}
