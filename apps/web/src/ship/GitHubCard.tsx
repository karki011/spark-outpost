import './github-card.css';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitHubConnectionStatus } from '@spark-outpost/contracts';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { GitHubAppPanel, useGitHubSignIn } from './GitHubAppPanel.tsx';
import { GitHubRouteTest } from './GitHubRouteTest.tsx';
import { TokenDetails, TokenForm } from './GitHubTokenPanel.tsx';
import { githubApi, shipKeys } from './ship-api.ts';

type Method = 'gh' | 'token' | 'app';

const DESCRIPTION =
  'Ship commits and pushes with your own Git. Opening a pull request needs GitHub.';

const APP_METHOD: { id: Method; label: string } = { id: 'app', label: 'GitHub sign-in' };
const METHODS: { id: Method; label: string }[] = [
  { id: 'gh', label: 'gh CLI' },
  { id: 'token', label: 'Personal token' },
];

function defaultMethod(status: GitHubConnectionStatus): Method {
  if (status.app.available && status.app.state !== 'signed_out') return 'app';
  if (status.active === 'token') return 'token';
  if (status.ghCli.login) return 'gh';
  return status.app.available ? 'app' : 'token';
}

function ghCliState(ghCli: GitHubConnectionStatus['ghCli']): { tone: string; line: string } {
  if (ghCli.login) {
    return { tone: 'ok', line: `Signed in as ${ghCli.login} on ${ghCli.host}.` };
  }
  if (ghCli.installed) return { tone: 'warn', line: 'Installed but not signed in.' };
  return { tone: 'off', line: 'Not installed.' };
}

function ghCliHowTo(ghCli: GitHubConnectionStatus['ghCli']): ReactNode {
  if (ghCli.login) return 'Spark runs gh and never reads its token.';
  if (ghCli.installed) {
    return (
      <>
        Run <code>gh auth login</code> in a terminal, then check again.
      </>
    );
  }
  return (
    <>
      Install the GitHub CLI and run <code>gh auth login</code> to use your login.
    </>
  );
}

export function activeLine(status: GitHubConnectionStatus): string {
  if (status.active === 'app') return `Signed in to GitHub as ${status.app.login ?? 'you'}`;
  if (status.active === 'gh_cli') {
    return `Connected through the gh CLI as ${status.ghCli.login ?? 'you'}`;
  }
  if (status.active === 'token' && status.token) {
    return `Connected with a token as ${status.token.login}`;
  }
  return 'Not connected';
}

function statusLine(status: GitHubConnectionStatus): string {
  const line = status.active ? activeLine(status) : DESCRIPTION;
  return status.app.state === 'needs_sign_in' ? `Sign in again · ${line}` : line;
}

function GhCliPanel({
  ghCli,
  checking,
  onCheck,
}: {
  ghCli: GitHubConnectionStatus['ghCli'];
  checking: boolean;
  onCheck: () => void;
}) {
  const state = ghCliState(ghCli);
  return (
    <>
      <p className={`gh-state ${state.tone}`}>{state.line}</p>
      <p className="gh-note">{ghCliHowTo(ghCli)}</p>
      {!ghCli.login && (
        <button type="button" className="btn line sm" onClick={onCheck} disabled={checking}>
          Check again
        </button>
      )}
    </>
  );
}

export function GitHubCard({
  icon,
  open,
  onToggle,
}: {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<Method | null>(null);
  const status = useQuery({ queryKey: shipKeys.github, queryFn: githubApi.connection });
  const saved = (next: GitHubConnectionStatus) => {
    queryClient.setQueryData(shipKeys.github, next);
    void queryClient.invalidateQueries({ queryKey: shipKeys.prRoutes });
    setChoice(null);
    if (open) onToggle();
  };
  const save = useMutation({
    mutationFn: ({ token, host }: { token: string; host: string | undefined }) =>
      githubApi.saveToken(host ? { token, host } : { token }),
    onSuccess: saved,
  });
  const remove = useMutation({ mutationFn: githubApi.removeToken, onSuccess: saved });
  const data = status.data;
  const flow = useGitHubSignIn(data?.app.available ?? false);
  const busy = save.isPending || remove.isPending;
  const methods = data?.app.available ? [APP_METHOD, ...METHODS] : METHODS;
  const signingIn = flow?.status === 'waiting' || flow?.status === 'starting';
  const method = choice ?? (signingIn ? 'app' : data ? defaultMethod(data) : 'token');
  const methodLabel = methods.find((option) => option.id === method)?.label ?? '';

  return (
    <ConnectorCard
      connectorId="github"
      name="GitHub"
      icon={icon}
      status={data ? statusLine(data) : DESCRIPTION}
      badge={status.isPending ? 'checking' : data?.active ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      <div className="cx-body gh-body">
        {data?.active && <p>{DESCRIPTION}</p>}
        {status.isError && <p className="gh-err">{status.error.message}</p>}
        {data && (
          <>
            <Segmented
              ariaLabel="How to connect GitHub"
              options={methods}
              value={method}
              onChange={(id) => setChoice(id as Method)}
            />
            <section className="gh-method" aria-label={methodLabel}>
              {method === 'gh' && (
                <GhCliPanel
                  ghCli={data.ghCli}
                  checking={status.isFetching}
                  onCheck={() => void status.refetch()}
                />
              )}
              {method === 'token' &&
                (data.token ? (
                  <TokenDetails token={data.token} busy={busy} onRemove={() => remove.mutate()} />
                ) : (
                  <TokenForm
                    busy={busy}
                    error={save.error?.message ?? null}
                    onSave={(token, host) => save.mutate({ token, host })}
                  />
                ))}
              {method === 'app' && (
                <GitHubAppPanel app={data.app} flow={flow} onUseToken={() => setChoice('token')} />
              )}
            </section>
            <GitHubRouteTest status={data} />
          </>
        )}
      </div>
    </ConnectorCard>
  );
}
