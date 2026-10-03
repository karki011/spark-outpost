import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PR_ROUTE_LABELS, type GitHubConnectionStatus } from '@spark-outpost/contracts';
import { githubApi, shipKeys } from './ship-api.ts';

export function activeRouteLine(status: GitHubConnectionStatus): string {
  if (status.active === 'token') return PR_ROUTE_LABELS.token;
  if (status.active === 'gh_cli') return PR_ROUTE_LABELS.gh_cli;
  return `${PR_ROUTE_LABELS.link} (GitHub remotes)`;
}

const REACH_TONES = { git: 'ok', token: 'ok', failed: 'warn', none: 'off' } as const;

export function GitHubRouteTest({ status }: { status: GitHubConnectionStatus }) {
  const queryClient = useQueryClient();
  const test = useMutation({
    mutationFn: githubApi.test,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: shipKeys.prRoutes }),
  });
  return (
    <section className="gh-route" aria-label="Pull request route">
      <p>
        <b>Pull requests:</b> {activeRouteLine(status)}
      </p>
      <p className="gh-note">
        Spark pushes with your git login first, then with the GitHub connection. It opens PRs with
        the connection, then your gh login, else gives you a Create PR link.
      </p>
      <button
        type="button"
        className="btn line sm"
        disabled={test.isPending}
        aria-busy={test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? 'Testing…' : 'Test'}
      </button>
      {test.isError && (
        <p className="gh-err" role="alert">
          {test.error.message}
        </p>
      )}
      {test.data && (
        <ul className="gh-test" aria-label="Test results">
          {test.data.projects.length === 0 && <li>No projects to test yet.</li>}
          {test.data.projects.map((result) => (
            <li key={result.project} className={`gh-state ${REACH_TONES[result.reach]}`}>
              <b>{result.project}</b> · {PR_ROUTE_LABELS[result.route]}
              {result.detail && <span> · {result.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
