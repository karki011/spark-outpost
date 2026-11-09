import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GitHubAppSignIn,
  GitHubAppStatus,
  GitHubConnectionStatus,
} from '@spark-outpost/contracts';
import { homeKeys } from '../home/home-api.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { githubApi, shipKeys } from './ship-api.ts';
import { outsideTarget } from '../browser/outside-link.ts';

const POLL_MS = 2000;
const SHOWN_REPOS = 8;
const REVOKE_URL = 'https://github.com/settings/apps/authorizations';
const LIMITED = 'Spark can only use the repositories you pick on GitHub.';

const inProgress = (flow: GitHubAppSignIn | undefined) =>
  flow?.status === 'starting' || flow?.status === 'waiting';

export function useGitHubSignIn(available: boolean) {
  const queryClient = useQueryClient();
  const flow = useQuery({
    queryKey: shipKeys.githubSignIn,
    queryFn: githubApi.signIn,
    enabled: available,
    refetchInterval: (query) => (inProgress(query.state.data) ? POLL_MS : false),
  });
  const status = flow.data?.status;
  useEffect(() => {
    if (status !== 'connected') return;
    void queryClient.invalidateQueries({ queryKey: shipKeys.github });
    void queryClient.invalidateQueries({ queryKey: shipKeys.prRoutes });
    void queryClient.invalidateQueries({ queryKey: homeKeys.health });
  }, [status, queryClient]);
  return flow.data;
}

function initials(login: string): string {
  const letters = login.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || '?').toUpperCase();
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function CodePanel({
  flow,
  cancelling,
  onCancel,
}: {
  flow: GitHubAppSignIn;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const copy = useCopyFeedback();
  if (!flow.userCode || !flow.verificationUri) {
    return (
      <Skeleton label="Getting a sign-in code from GitHub" rows={2} className="gh-code-skel" />
    );
  }
  const code = flow.userCode;
  return (
    <div className="gh-code" role="group" aria-label="GitHub sign-in code">
      <p className="gh-note">Open GitHub and enter this code. Spark never types it for you.</p>
      <div className="gh-code-row">
        <output className="gh-code-value" aria-label={`Code ${code.split('').join(' ')}`}>
          {code}
        </output>
        <button type="button" className="btn line sm" onClick={() => copy.copy(code)}>
          {copyButtonText(copy.state)}
        </button>
        <span className="sr-only" role="status">
          {copy.state === 'copied' ? 'Code copied' : ''}
        </span>
      </div>
      <div className="gh-actions">
        <a
          className="btn primary sm"
          href={flow.verificationUri}
          target={outsideTarget()}
          rel="noreferrer"
        >
          Open GitHub
          <ExternalLinkIcon />
        </a>
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={cancelling}>
          Cancel
        </button>
      </div>
      <p className="gh-state warn" role="status">
        Waiting for you to finish on GitHub
        {flow.expiresAt ? ` · code works until ${clock(flow.expiresAt)}` : ''}
      </p>
    </div>
  );
}

function Coverage({ app }: { app: GitHubAppStatus }) {
  if (app.projects.length === 0) {
    return <p className="gh-note">None of your projects has a github.com remote yet.</p>;
  }
  return (
    <ul className="gh-cover" aria-label="Your projects">
      {app.projects.map((project) => (
        <li key={`${project.project}:${project.repo}`}>
          <span className={`gh-state ${project.covered ? 'ok' : 'warn'}`}>
            <b>{project.project}</b>
            <span className="gh-cover-repo">{project.repo}</span>
            {project.covered ? 'covered' : 'not covered'}
          </span>
          {!project.covered && app.installUrl && (
            <a className="gh-link" href={app.installUrl} target={outsideTarget()} rel="noreferrer">
              Give Spark access to this repo
              <ExternalLinkIcon />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function RepoList({ app }: { app: GitHubAppStatus }) {
  const hidden = app.repos.length - SHOWN_REPOS;
  return (
    <details className="gh-repos">
      <summary>
        {app.repos.length === 1 ? '1 repository' : `${app.repos.length} repositories`} picked on
        GitHub{app.reposTruncated ? ' (first 1,000 shown)' : ''}
      </summary>
      <ul aria-label="Repositories Spark can use">
        {app.repos.slice(0, SHOWN_REPOS).map((repo) => (
          <li key={repo}>{repo}</li>
        ))}
        {hidden > 0 && <li className="gh-note">and {hidden} more</li>}
      </ul>
    </details>
  );
}

function useRecheckOnReturn(recheck: () => void, wanted: boolean) {
  useEffect(() => {
    if (!wanted) return;
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck, wanted]);
}

interface AppPanelProps {
  app: GitHubAppStatus;
  flow: GitHubAppSignIn | undefined;
  onUseToken: () => void;
}

export function GitHubAppPanel({ app, flow, onUseToken }: AppPanelProps) {
  const queryClient = useQueryClient();
  const setFlow = (next: GitHubAppSignIn) => queryClient.setQueryData(shipKeys.githubSignIn, next);
  const setStatus = (next: GitHubConnectionStatus) => {
    queryClient.setQueryData(shipKeys.github, next);
    void queryClient.invalidateQueries({ queryKey: shipKeys.prRoutes });
  };
  const start = useMutation({
    mutationFn: githubApi.startSignIn,
    onSuccess: setFlow,
    onError: () => void queryClient.invalidateQueries({ queryKey: shipKeys.githubSignIn }),
  });
  const cancel = useMutation({ mutationFn: githubApi.cancelSignIn, onSuccess: setFlow });
  const recheck = useMutation({ mutationFn: githubApi.recheckApp, onSuccess: setStatus });
  const disconnect = useMutation({
    mutationFn: githubApi.disconnectApp,
    onSuccess: (next) => {
      setStatus(next);
      void queryClient.invalidateQueries({ queryKey: shipKeys.githubSignIn });
      void queryClient.invalidateQueries({ queryKey: homeKeys.health });
    },
  });
  const connected = app.state === 'connected';
  const uncovered = app.projects.some((project) => !project.covered);
  const { mutate: recheckNow, isPending: rechecking } = recheck;
  useRecheckOnReturn(recheckNow, connected && uncovered);

  if (start.isPending || inProgress(flow)) {
    return (
      <CodePanel
        flow={
          flow ?? {
            status: 'starting',
            userCode: null,
            verificationUri: null,
            expiresAt: null,
            message: null,
          }
        }
        cancelling={cancel.isPending}
        onCancel={() => cancel.mutate()}
      />
    );
  }

  const problem =
    start.error?.message ?? (flow && flow.status !== 'connected' ? flow.message : null);
  const signInButton = (label: string) => (
    <button type="button" className="btn primary sm" onClick={() => start.mutate()}>
      {label}
    </button>
  );

  if (!connected) {
    const again = app.state === 'needs_sign_in';
    return (
      <div className="gh-app">
        {again ? (
          <p className="gh-state warn" role="status">
            Your GitHub sign-in as @{app.login} ended. Sign in again to keep opening pull requests
            this way.
          </p>
        ) : (
          <p className="gh-note">
            Sign in on GitHub and pick the repositories Spark may use. {LIMITED} No token to paste,
            and access renews itself.
          </p>
        )}
        {problem && (
          <p className="gh-err" role="alert">
            {problem}
          </p>
        )}
        <div className="gh-actions">
          {signInButton(again ? 'Sign in again' : 'Sign in with GitHub')}
          {again && (
            <button
              type="button"
              className="btn ghost sm danger"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              Disconnect
            </button>
          )}
          <button type="button" className="gh-link" onClick={onUseToken}>
            Use a token instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gh-app">
      <div className="gh-who">
        <span className="gh-avatar" aria-hidden="true">
          {initials(app.login ?? '')}
        </span>
        <p className="gh-state ok">Signed in as @{app.login}</p>
      </div>
      <p className="gh-note">{LIMITED} Pull requests open as you.</p>
      <Coverage app={app} />
      {app.repos.length > 0 ? (
        <RepoList app={app} />
      ) : (
        <p className="gh-note">
          No repositories picked yet.{' '}
          {app.installUrl && (
            <a className="gh-link" href={app.installUrl} target={outsideTarget()} rel="noreferrer">
              Pick repositories on GitHub
              <ExternalLinkIcon />
            </a>
          )}
        </p>
      )}
      {(recheck.error ?? disconnect.error) && (
        <p className="gh-err" role="alert">
          {(recheck.error ?? disconnect.error)?.message}
        </p>
      )}
      <div className="gh-actions">
        <button
          type="button"
          className="btn line sm"
          onClick={() => recheckNow()}
          disabled={rechecking}
          aria-busy={rechecking}
        >
          {rechecking ? 'Checking…' : 'Check again'}
        </button>
        <button
          type="button"
          className="btn ghost sm danger"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          Disconnect
        </button>
        <a className="gh-link" href={REVOKE_URL} target={outsideTarget()} rel="noreferrer">
          Revoke on GitHub
          <ExternalLinkIcon />
        </a>
      </div>
    </div>
  );
}
