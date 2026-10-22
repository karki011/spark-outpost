import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentConfigApi, agentConfigKey, projectTrustKey } from '../api/agent-config.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { PlusIcon } from '../ui/icons.tsx';
import { countLabel, filterProjects } from './project-filter.ts';
import { ProjectRow } from './ProjectRow.tsx';

const FILTER_FROM = 6;

export function ProjectsSection() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const trust = useQuery({ queryKey: projectTrustKey, queryFn: agentConfigApi.trustList });
  const [filter, setFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const adder = useAddFolder({ onAdded: (project) => setOpenId(project.id) });
  const revoke = useMutation({
    mutationFn: (projectId: string) => agentConfigApi.setTrust(projectId, { trusted: false }),
    onSuccess: (config) => {
      queryClient.setQueryData(agentConfigKey(config.projectId), config);
      void queryClient.invalidateQueries({ queryKey: projectTrustKey });
    },
  });
  const byProject = new Map((trust.data ?? []).map((entry) => [entry.projectId, entry]));
  const error = projects.error ?? trust.error ?? revoke.error;
  const all = projects.data ?? [];
  const filterable = all.length >= FILTER_FROM;
  const shown = filterable ? filterProjects(all, filter) : all;
  return (
    <>
      <p className="lede">
        Folders you linked, whether you trust their hooks, allow rules and MCP servers, and where
        Spark works in them. To trust a folder, open Agent setup in a chat that uses it.
      </p>
      <div className="set-projects-add" role="group" aria-label="Add a project">
        {adder.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="btn line sm"
            disabled={adder.busy || action.disabled}
            title={action.description}
            onClick={action.onSelect}
          >
            <PlusIcon />
            {action.label}
          </button>
        ))}
      </div>
      {adder.error && (
        <p className="set-hint bad" role="alert">
          {adder.error}
        </p>
      )}
      {adder.flow}
      {error && (
        <p className="set-hint" role="alert">
          {error.message}
        </p>
      )}
      {projects.data?.length === 0 && <p className="set-hint">No linked folders yet.</p>}
      {filterable && (
        <div className="set-projects-bar">
          <input
            type="search"
            className="inp"
            aria-label="Filter projects"
            placeholder="Filter by name or path"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="set-hint" role="status">
            {countLabel(shown.length, all.length)}
          </span>
        </div>
      )}
      {filterable && shown.length === 0 && (
        <p className="set-hint">No projects match “{filter.trim()}”.</p>
      )}
      <ul className="set-projects" aria-label="Linked folders">
        {shown.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            trust={byProject.get(project.id)}
            open={project.id === openId}
            busy={revoke.isPending}
            onToggle={() => setOpenId(project.id === openId ? null : project.id)}
            onRevoke={() => revoke.mutate(project.id)}
          />
        ))}
      </ul>
    </>
  );
}
