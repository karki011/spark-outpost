import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectTrust } from '@spark-outpost/contracts';
import { agentConfigApi, agentConfigKey, projectTrustKey } from '../api/agent-config.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { ProjectBrowser } from './ProjectBrowser.tsx';
import { ProjectBuilders } from './ProjectBuilders.tsx';
import { ProjectPreview } from './ProjectPreview.tsx';

function trustLabel(trust: ProjectTrust | undefined): string {
  if (!trust) return 'Not asked yet';
  if (!trust.trusted) return 'Not trusted';
  return trust.redirectsConfirmed ? 'Trusted, with key and proxy settings' : 'Trusted';
}

function ProjectRow({
  project,
  trust,
  busy,
  parallelAvailable,
  onRevoke,
}: {
  project: Project;
  trust: ProjectTrust | undefined;
  busy: boolean;
  parallelAvailable: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="set-project">
      <div className="set-project-head">
        <span className="set-project-text">
          <b>{project.name}</b>
          <small>{project.rootPath}</small>
        </span>
        <span className="set-project-trust">{trustLabel(trust)}</span>
        {trust?.trusted && (
          <button
            type="button"
            className="btn line sm"
            aria-label={`Stop trusting ${project.name}`}
            disabled={busy}
            onClick={onRevoke}
          >
            Stop trusting
          </button>
        )}
      </div>
      <ProjectBuilders project={project} available={parallelAvailable} />
      <ProjectBrowser project={project} />
      <ProjectPreview project={project} />
    </li>
  );
}

export function ProjectsSection() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const trust = useQuery({ queryKey: projectTrustKey, queryFn: agentConfigApi.trustList });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const revoke = useMutation({
    mutationFn: (projectId: string) => agentConfigApi.setTrust(projectId, { trusted: false }),
    onSuccess: (config) => {
      queryClient.setQueryData(agentConfigKey(config.projectId), config);
      void queryClient.invalidateQueries({ queryKey: projectTrustKey });
    },
  });
  const byProject = new Map((trust.data ?? []).map((entry) => [entry.projectId, entry]));
  const error = projects.error ?? trust.error ?? revoke.error;
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
      <ul className="set-projects" aria-label="Linked folders">
        {(projects.data ?? []).map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            trust={byProject.get(project.id)}
            busy={revoke.isPending}
            parallelAvailable={setup.data?.parallelBuilders ?? true}
            onRevoke={() => revoke.mutate(project.id)}
          />
        ))}
      </ul>
    </>
  );
}
