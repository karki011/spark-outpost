import './github-card.css';
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  githubTokenHint,
  type GitHubConnectionStatus,
  type GitHubTokenInfo,
} from '@spark-outpost/contracts';
import { githubApi, shipKeys } from './ship-api.ts';

const ACCESS_LABELS = { push: 'can push', read: 'read only', none: 'no access' } as const;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function activeLine(status: GitHubConnectionStatus): string {
  if (status.active === 'gh_cli') {
    return `Connected through the gh CLI as ${status.ghCli.login ?? 'you'}`;
  }
  if (status.active === 'token' && status.token) {
    return `Connected with a token as ${status.token.login}`;
  }
  return 'Not connected';
}

function TokenDetails({
  token,
  onRemove,
  busy,
}: {
  token: GitHubTokenInfo;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <div className="gh-token">
      <dl className="gh-facts">
        <dt>Host</dt>
        <dd>{token.host}</dd>
        <dt>Access</dt>
        <dd>{token.scopes.length > 0 ? token.scopes.join(', ') : 'Fine-grained token'}</dd>
        <dt>Expires</dt>
        <dd>{token.expiresAt ? day(token.expiresAt) : 'No expiry reported'}</dd>
        {token.repos.map((repo) => (
          <Row key={repo.repo} label={repo.repo}>
            {ACCESS_LABELS[repo.access]}
          </Row>
        ))}
      </dl>
      <button type="button" className="btn ghost sm danger" onClick={onRemove} disabled={busy}>
        Remove token
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function TokenForm({
  onSave,
  busy,
  error,
}: {
  onSave: (token: string, host: string | undefined) => void;
  busy: boolean;
  error: string | null;
}) {
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [show, setShow] = useState(false);
  const hostId = useId();
  const hint = githubTokenHint(token);
  const submit = () => {
    if (hint.valid && !busy) onSave(token.trim(), host.trim() || undefined);
  };
  return (
    <div className="gh-form">
      <div className="gh-keyrow">
        <input
          className="inp"
          type={show ? 'text' : 'password'}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="github_pat_…"
          autoComplete="off"
          spellCheck={false}
          aria-label="GitHub personal access token"
          disabled={busy}
        />
        <button
          type="button"
          className="btn line sm"
          onClick={() => setShow(!show)}
          disabled={busy}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      <label className="gh-host" htmlFor={hostId}>
        GitHub Enterprise host (leave empty for github.com)
      </label>
      <input
        id={hostId}
        className="inp"
        value={host}
        onChange={(event) => setHost(event.target.value)}
        placeholder="github.com"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      <p className="gh-note">{hint.message}</p>
      {error && (
        <p className="gh-err" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn primary sm"
        onClick={submit}
        disabled={busy || !hint.valid}
      >
        {busy ? 'Verifying…' : 'Verify token'}
      </button>
    </div>
  );
}

export function GitHubCard({ icon }: { icon: ReactNode }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: shipKeys.github, queryFn: githubApi.connection });
  const saved = (next: GitHubConnectionStatus) => queryClient.setQueryData(shipKeys.github, next);
  const save = useMutation({
    mutationFn: ({ token, host }: { token: string; host: string | undefined }) =>
      githubApi.saveToken(host ? { token, host } : { token }),
    onSuccess: saved,
  });
  const remove = useMutation({ mutationFn: githubApi.removeToken, onSuccess: saved });
  const data = status.data;
  const busy = save.isPending || remove.isPending;

  return (
    <li className="ccard gh-card">
      <div className="top">
        <span className="plogo">{icon}</span>
        <b>GitHub</b>
        {data && (
          <span className={data.active ? 'gh-badge on' : 'gh-badge'}>
            {data.active ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>
      <p>Ship commits and pushes with your own Git. Opening a draft pull request needs GitHub.</p>
      {status.isPending && <p className="gh-note">Checking…</p>}
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {data && (
        <>
          <p className="gh-active" role="status">
            {activeLine(data)}
          </p>
          <section className="gh-method" aria-label="gh CLI">
            <h4>gh CLI</h4>
            <p className="gh-note">
              {data.ghCli.login
                ? `Signed in as ${data.ghCli.login} on ${data.ghCli.host}. Spark runs gh and never reads its token.`
                : data.ghCli.installed
                  ? 'Installed but not signed in. Run gh auth login in a terminal, then check again.'
                  : 'Not installed. Install the GitHub CLI and run gh auth login to use your login.'}
            </p>
            {!data.ghCli.login && (
              <button
                type="button"
                className="btn line sm"
                onClick={() => void status.refetch()}
                disabled={status.isFetching}
              >
                Check again
              </button>
            )}
          </section>
          <section className="gh-method" aria-label="Personal access token">
            <h4>Personal access token</h4>
            {data.token ? (
              <TokenDetails token={data.token} busy={busy} onRemove={() => remove.mutate()} />
            ) : (
              <TokenForm
                busy={busy}
                error={save.error?.message ?? null}
                onSave={(token, host) => save.mutate({ token, host })}
              />
            )}
          </section>
          <section className="gh-method" aria-label="GitHub App">
            <h4>GitHub App</h4>
            <span className="soon">Coming later</span>
          </section>
        </>
      )}
    </li>
  );
}
