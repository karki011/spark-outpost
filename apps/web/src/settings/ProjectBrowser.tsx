import '../chat/project/agent-setup.css';
import '../browser/browser-pane.css';
import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Keep sign-ins in the browser';
const ON_HINT =
  'Sites you sign in to in the Browser pane stay signed in for every chat in this project. Cookies are stored on this Mac.';
const OFF_HINT = 'Each chat starts signed out, and nothing is kept when it closes.';
const WEB_HINT = 'The Browser pane is available in the Mac app.';

function sitesKey(projectId: string) {
  return ['browser-sites', projectId] as const;
}

function SignedInSites({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const browser = desktopBrowser();
  const sites = useQuery({
    queryKey: sitesKey(project.id),
    queryFn: async () => (await browser?.sites(project.id)) ?? [],
    enabled: browser !== null,
  });
  const signOut = useMutation({
    mutationFn: async (origin: string | null) => (await browser?.signOut(project.id, origin)) ?? [],
    onSuccess: (left) => queryClient.setQueryData(sitesKey(project.id), left),
  });
  if (!browser || !sites.data) return null;
  if (sites.data.length === 0) {
    return <p className="set-hint">No signed-in sites in {project.name}.</p>;
  }
  return (
    <div className="set-sites" role="group" aria-label={`Signed-in sites in ${project.name}`}>
      <p className="set-hint">Signed-in sites</p>
      <ul className="set-site-list">
        {sites.data.map((site) => (
          <li key={site.origin}>
            <code>{site.origin}</code>
            <button
              type="button"
              className="btn ghost sm"
              disabled={signOut.isPending}
              aria-label={`Sign out of ${site.origin}`}
              onClick={() => signOut.mutate(site.origin)}
            >
              Sign out
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn line sm"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate(null)}
      >
        Clear all
      </button>
    </div>
  );
}

export function ProjectBrowser({ project }: { project: Project }) {
  const switchId = useId();
  const hintId = useId();
  const queryClient = useQueryClient();
  const available = desktopBrowser() !== null;
  const save = useMutation({
    mutationFn: (keep: boolean) =>
      projectsApi.updateBuilders(project.id, { browserKeepSignIns: keep }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    },
  });
  const keep = save.isPending ? save.variables : (project.browserKeepSignIns ?? true);
  const hint = save.error?.message ?? (available ? (keep ? ON_HINT : OFF_HINT) : WEB_HINT);
  return (
    <div className="set-builders" role="group" aria-label={`Browser in ${project.name}`}>
      <SettingRow
        label={LABEL}
        controlId={switchId}
        doc={{ page: 'use-the-browser' }}
        hint={hint}
        hintId={hintId}
      >
        <BlobToggle
          kind="plain"
          id={switchId}
          label={`${LABEL} in ${project.name}`}
          checked={keep}
          describedBy={hintId}
          onChange={(next) => save.mutate(next)}
        />
      </SettingRow>
      {keep && <SignedInSites project={project} />}
    </div>
  );
}
