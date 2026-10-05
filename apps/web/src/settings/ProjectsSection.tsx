import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentConfigApi, agentConfigKey, projectTrustKey } from '../api/agent-config.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { countLabel, filterProjects, openProjectId } from './project-filter.ts';
import { ProjectRow } from './ProjectRow.tsx';

const FILTER_FROM = 6;

export function ProjectsSection() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const trust = useQuery({ queryKey: projectTrustKey, queryFn: agentConfigApi.trustList });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const [filter, setFilter] = useState('');
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
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
  const openId = openProjectId(all, chosen);
  return (
    <>
      <p className="lede">
        Folders you linked, whether you trust their hooks, allow rules and MCP servers, and how
        Builders work in them. To trust a folder, open Agent setup in a chat that uses it.
      </p>
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
            parallelAvailable={setup.data?.parallelBuilders ?? true}
            onToggle={() => setChosen(project.id === openId ? null : project.id)}
            onRevoke={() => revoke.mutate(project.id)}
          />
        ))}
      </ul>
    </>
  );
}
