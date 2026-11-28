import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  CloudflareReach,
  CloudflareReachPermission,
  CloudflareReachStepId,
  RemoteAccess,
  SetupFields,
} from '@spark-outpost/contracts';
import { parseCustomDomain } from '../phone/custom-domain.ts';
import { phoneApi } from '../phone/phone-api.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import {
  OutsideLink,
  PermissionList,
  StepList,
  type PermissionCopy,
} from './CloudflareChecklist.tsx';
import { PreparedSetups } from '../setup-drafts/PreparedSetups.tsx';
import { REMOTE_SETUPS } from '../setup-drafts/setup-groups.ts';
import { usePreparedSetup } from '../setup-drafts/use-setup-drafts.ts';
import { useCloudflareReach } from './use-cloudflare-reach.ts';

export const REACH_HEADING = 'Set it up with Cloudflare';
export const REACH_LEDE =
  'Sign in to Cloudflare once. Spark gives this computer an address on your domain, with a sign-in page in front. About 2 minutes.';
export const REACH_ASKS = 'What Spark asks Cloudflare for (5 permissions)';
export const REACH_KEEPS =
  'The sign-in ends when set-up finishes. Spark keeps only the tunnel’s key, in this computer’s keychain.';
export const REACH_EMAIL_HELP = 'Only this email can open the address.';

const PERMISSIONS: Record<CloudflareReachPermission, PermissionCopy> = {
  account: {
    title: 'See which account this is',
    detail: 'So Spark sets up the right account.',
    cloudflare: 'Account Settings: Read',
  },
  domains: {
    title: 'See your domains',
    detail: 'To find the domain your address belongs to.',
    cloudflare: 'Zone: Read',
  },
  dns: {
    title: 'Add one DNS record',
    detail:
      'Points your address at the tunnel. Cloudflare grants this for every domain; Spark adds one record and changes no other.',
    cloudflare: 'DNS: Edit',
  },
  tunnel: {
    title: 'Create a tunnel',
    detail: 'The private link between Cloudflare and this computer.',
    cloudflare: 'Cloudflare Tunnel: Edit',
  },
  access: {
    title: 'Add a sign-in page',
    detail: 'So only you can open the address.',
    cloudflare: 'Access: Apps and Policies: Edit',
  },
};

const STEPS: Record<CloudflareReachStepId, string> = {
  signIn: 'Sign in to Cloudflare',
  domain: 'Find your domain',
  tunnel: 'Create the tunnel',
  address: 'Add the address',
  signInPage: 'Add the sign-in page',
  start: 'Connect this computer',
};

function progressLine(reach: CloudflareReach): string {
  const done = reach.steps.filter((step) => step.state === 'done').length;
  if (reach.status === 'waiting') return 'Waiting for you to allow Spark in Cloudflare.';
  if (reach.status === 'stopped') {
    return `${done} of ${reach.steps.length} steps done. Finished steps are kept.`;
  }
  const active = reach.steps.find((step) => step.state === 'working');
  const doing = active ? `: ${STEPS[active.id].toLowerCase()}` : '';
  return `Setting up${doing}. ${done} of ${reach.steps.length} steps done.`;
}

interface CloudflareReachSetupProps {
  onSaved: (access: RemoteAccess) => void;
}

export function CloudflareReachSetup({ onSaved }: CloudflareReachSetupProps) {
  const ids = useId();
  const auto = useCloudflareReach();
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [tried, setTried] = useState(false);
  const prepared = usePreparedSetup('remote_cloudflare');
  const [applied, setApplied] = useState<SetupFields | null>(null);
  if (prepared.fields && prepared.fields !== applied) {
    setApplied(prepared.fields);
    setAddress((current) => current || (prepared.fields?.address ?? ''));
    setEmail((current) => current || (prepared.fields?.email ?? ''));
  }
  const turnedOn = useRef(false);
  const turnOn = useMutation({
    mutationFn: (hostname: string) => phoneApi.setAccess({ hostname, confirmed: true }),
    onSuccess: onSaved,
  });
  const reach = auto.reach;
  const finished = reach?.status === 'done' ? reach.hostname : null;
  const mutate = turnOn.mutate;
  useEffect(() => {
    if (!finished || turnedOn.current) return;
    turnedOn.current = true;
    mutate(finished);
  }, [finished, mutate]);
  if (!reach?.available) return null;

  const parsed = parseCustomDomain(address);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const addressProblem = !parsed.ok && (address.trim() !== '' || tried) ? parsed.problem : null;
  const emailProblem =
    !emailOk && (email.trim() !== '' || tried) ? 'Type your email address.' : null;
  const started = reach.status !== 'idle';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!parsed.ok || !emailOk || auto.busy) return;
    turnedOn.current = false;
    prepared.clear();
    auto.start({ hostname: parsed.hostname, email: email.trim() });
  };
  return (
    <section className="ph-card cf-auto" aria-labelledby={`${ids}-heading`}>
      <h3 id={`${ids}-heading`} className="cf-auto-title">
        {REACH_HEADING}
      </h3>
      {started ? (
        <>
          <p role="status">{progressLine(reach)}</p>
          {reach.hostname && <p className="cf-host">{reach.hostname}</p>}
          <StepList steps={reach.steps} labels={STEPS} busy={auto.busy} onFix={auto.resume} />
          {reach.signedIn && reach.status === 'stopped' && (
            <p>
              Spark stays signed in to Cloudflare for up to an hour so it can carry on. Start over
              ends the sign-in now.
            </p>
          )}
          {turnOn.isPending && <p role="status">Turning Remote control on at this address…</p>}
          {turnOn.error && (
            <p className="ph-error" role="alert">
              {turnOn.error.message}
            </p>
          )}
          <div className="cx-actions">
            {reach.status === 'waiting' && reach.authorizeUrl && (
              <OutsideLink href={reach.authorizeUrl} label="Open Cloudflare again" />
            )}
            <button
              type="button"
              className="btn ghost sm"
              disabled={auto.busy}
              onClick={auto.cancel}
            >
              {reach.status === 'stopped' || reach.status === 'done' ? 'Start over' : 'Cancel'}
            </button>
          </div>
        </>
      ) : (
        <form className="cf-reach-form" noValidate onSubmit={submit}>
          <p>{REACH_LEDE}</p>
          <PreparedSetups targets={REMOTE_SETUPS} />
          <div className="field">
            <label htmlFor={`${ids}-address`} className="ph-field-label">
              Address
            </label>
            <input
              id={`${ids}-address`}
              className="inp"
              placeholder="spark.example.com"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={address}
              maxLength={253}
              aria-invalid={addressProblem !== null}
              aria-describedby={`${ids}-address-help`}
              onChange={(event) => setAddress(event.target.value)}
            />
            <p id={`${ids}-address-help`} className={addressProblem ? 'ph-error' : 'ph-note'}>
              {addressProblem ??
                'A name on a domain you already have in Cloudflare. No domain? Use Tailscale.'}
            </p>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-email`} className="ph-field-label">
              Your email
            </label>
            <input
              id={`${ids}-email`}
              className="inp"
              type="email"
              autoComplete="email"
              value={email}
              maxLength={254}
              aria-invalid={emailProblem !== null}
              aria-describedby={`${ids}-email-help`}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p id={`${ids}-email-help`} className={emailProblem ? 'ph-error' : 'ph-note'}>
              {emailProblem ?? REACH_EMAIL_HELP}
            </p>
          </div>
          <details className="cf-asks">
            <summary>{REACH_ASKS}</summary>
            <PermissionList permissions={reach.permissions} copy={PERMISSIONS} />
          </details>
          <p>{REACH_KEEPS}</p>
          <div className="cx-actions">
            <button type="submit" className="btn primary sm" disabled={auto.busy}>
              Allow on Cloudflare
              <ExternalLinkIcon />
              <span className="sr-only"> (opens in your browser)</span>
            </button>
          </div>
        </form>
      )}
      {auto.error && (
        <p className="ph-error" role="alert">
          {auto.error.message}
        </p>
      )}
    </section>
  );
}
