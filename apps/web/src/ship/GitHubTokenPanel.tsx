import { Fragment, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { githubTokenHint, type GitHubTokenInfo } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { fadeReveal } from '../ui/transitions.tsx';

const ACCESS_LABELS = { push: 'can push', read: 'read only', none: 'no access' } as const;

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function TokenDetails({
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
          <Fragment key={repo.repo}>
            <dt>{repo.repo}</dt>
            <dd>{ACCESS_LABELS[repo.access]}</dd>
          </Fragment>
        ))}
      </dl>
      <button type="button" className="btn ghost sm danger" onClick={onRemove} disabled={busy}>
        Remove token
      </button>
    </div>
  );
}

export function TokenForm({
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
  const [enterprise, setEnterprise] = useState(false);
  const tokenId = useId();
  const hostId = useId();
  const hintId = useId();
  const hint = githubTokenHint(token);
  const submit = () => {
    if (hint.valid && !busy) onSave(token.trim(), host.trim() || undefined);
  };
  return (
    <div className="gh-form">
      <label className="gh-label" htmlFor={tokenId}>
        Personal access token
      </label>
      <div className="gh-keyrow">
        <input
          id={tokenId}
          className="inp mono"
          type={show ? 'text' : 'password'}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="github_pat_…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
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
      <p id={hintId} className="gh-note">
        {hint.message}
      </p>
      <button
        type="button"
        className="gh-disclose"
        aria-expanded={enterprise}
        onClick={() => setEnterprise(!enterprise)}
      >
        Using GitHub Enterprise?
        <ChevronIcon />
      </button>
      <AnimatePresence initial={false}>
        {enterprise && (
          <motion.div key="host" className="gh-collapse gh-host" {...fadeReveal}>
            <label className="gh-label" htmlFor={hostId}>
              Enterprise host
            </label>
            <input
              id={hostId}
              className="inp"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="github.example.com"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
