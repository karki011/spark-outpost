import '../tickets/connect.css';
import { use, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ARTIFACT_SHARE_UPLOAD_KEY_PATTERN,
  CLOUDFLARE_PROBLEMS,
  guideLink,
  shareServiceOrigin,
} from '@spark-outpost/contracts';
import { outsideTarget } from '../browser/outside-link.ts';
import { DocsReachable } from '../ui/DocLink.tsx';
import { BookIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { CloudflareAuto } from './CloudflareAuto.tsx';
import { cloudflareApi } from './cloudflare-api.ts';
import { useCloudflareSaved, useCloudflareSetup } from './use-cloudflare.ts';

const CLOUDFLARE_SIGN_UP_URL = 'https://dash.cloudflare.com/sign-up';
const CLOUDFLARE_GUIDE_PAGE = 'connect-cloudflare';

const CLOUDFLARE_LEDE =
  'Share artifacts from your own Cloudflare account. Shared pages are stored there and served from your address.';

function OutsideButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="btn line sm" href={href} target={outsideTarget()} rel="noreferrer">
      {children}
      <ExternalLinkIcon />
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="cf-step">
      <h4>{title}</h4>
      {children}
    </li>
  );
}

function addressProblem(address: string): string | null {
  if (address.trim() === '') return null;
  return shareServiceOrigin(address) ? null : CLOUDFLARE_PROBLEMS.address;
}

function keyProblem(uploadKey: string): string | null {
  if (uploadKey.trim() === '') return null;
  return ARTIFACT_SHARE_UPLOAD_KEY_PATTERN.test(uploadKey.trim()) ? null : CLOUDFLARE_PROBLEMS.key;
}

function ConnectForm() {
  const ids = useId();
  const saved = useCloudflareSaved();
  const [address, setAddress] = useState('');
  const [uploadKey, setUploadKey] = useState('');
  const [revealed, setRevealed] = useState(false);
  const connect = useMutation({ mutationFn: cloudflareApi.connect, onSuccess: saved });
  const addressError = addressProblem(address);
  const keyError = keyProblem(uploadKey);
  const filled = address.trim() !== '' && uploadKey.trim() !== '';
  const ready = filled && !addressError && !keyError && !connect.isPending;
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    if (connect.isError) connect.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) connect.mutate({ address: address.trim(), uploadKey: uploadKey.trim() });
  };
  return (
    <form
      className="tk-cform"
      aria-label="Connect Cloudflare"
      aria-busy={connect.isPending}
      onSubmit={submit}
      noValidate
    >
      <div className="tk-field">
        <label htmlFor={`${ids}address`}>Service address</label>
        <input
          id={`${ids}address`}
          className="inp"
          type="text"
          inputMode="url"
          required
          value={address}
          placeholder="https://spark-outpost-share.example.workers.dev"
          disabled={connect.isPending}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={addressError ? true : undefined}
          aria-describedby={addressError ? `${ids}address-error` : undefined}
          onChange={(event) => edit(setAddress)(event.target.value)}
        />
        {addressError && (
          <p id={`${ids}address-error`} className="tk-field-err" aria-live="polite">
            {addressError}
          </p>
        )}
      </div>
      <div className="tk-field">
        <label htmlFor={`${ids}key`}>Upload key</label>
        <div className="tk-keyrow">
          <input
            id={`${ids}key`}
            className="inp mono"
            type={revealed ? 'text' : 'password'}
            required
            value={uploadKey}
            placeholder="Paste the upload key"
            disabled={connect.isPending}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={keyError ? true : undefined}
            aria-describedby={keyError ? `${ids}key-error ${ids}key-help` : `${ids}key-help`}
            onChange={(event) => edit(setUploadKey)(event.target.value)}
          />
          <button
            type="button"
            className="btn line sm"
            disabled={connect.isPending}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        </div>
        {keyError && (
          <p id={`${ids}key-error`} className="tk-field-err" aria-live="polite">
            {keyError}
          </p>
        )}
        <p id={`${ids}key-help`} className="tk-field-help">
          Kept in this computer’s keychain. Only Spark with this key can add pages.
        </p>
      </div>
      {connect.isError && (
        <p className="tk-cform-err" role="alert">
          {connect.error.message}
        </p>
      )}
      <div className="tk-cform-acts">
        <button type="submit" className="btn primary sm" disabled={!ready}>
          {connect.isPending ? 'Checking…' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

function ByHand({ deployUrl }: { deployUrl: string }) {
  const needsId = useId();
  const docs = use(DocsReachable);
  return (
    <>
      <section className="cf-needs" aria-labelledby={needsId}>
        <h4 id={needsId}>What you need</h4>
        <ul>
          <li>A free Cloudflare account.</li>
          <li>
            A GitHub or GitLab account. Cloudflare’s Deploy button copies the share service into it.
          </li>
        </ul>
        <p>About 10 minutes. Until then, Share… uses Spark’s shared service with 1-day links.</p>
        {docs && (
          <a className="cf-guide" href={guideLink(CLOUDFLARE_GUIDE_PAGE)}>
            <BookIcon />
            Set-up guide
          </a>
        )}
      </section>
      <ol className="cf-steps">
        <Step title="Create a Cloudflare account">
          <p>Skip this step if you already have one.</p>
          <OutsideButton href={CLOUDFLARE_SIGN_UP_URL}>Create a free account</OutsideButton>
        </Step>
        <Step title="Deploy the share service">
          <OutsideButton href={deployUrl}>Deploy to Cloudflare</OutsideButton>
          <p>
            Opens Cloudflare in your browser. It creates a Worker and a storage bucket in your
            account and asks you to set an upload key.
          </p>
        </Step>
        <Step title="Connect it to Spark">
          <ConnectForm />
        </Step>
      </ol>
    </>
  );
}

export function CloudflareSetup({ deployUrl }: { deployUrl: string }) {
  const auto = useCloudflareSetup();
  const setup = auto.setup;
  if (!setup?.available) {
    return (
      <div className="cx-body cf-setup">
        <p>{CLOUDFLARE_LEDE}</p>
        <ByHand deployUrl={deployUrl} />
      </div>
    );
  }
  return (
    <div className="cx-body cf-setup">
      <p>{CLOUDFLARE_LEDE}</p>
      <CloudflareAuto setup={setup} auto={auto} />
      <details className="cf-hand">
        <summary>Set it up by hand instead</summary>
        <ByHand deployUrl={deployUrl} />
      </details>
    </div>
  );
}
