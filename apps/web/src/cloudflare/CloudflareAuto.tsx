import { useId } from 'react';
import type {
  CloudflareSetup,
  CloudflareSetupStep,
  CloudflareSetupStepId,
  CloudflareSharePermission,
} from '@spark-outpost/contracts';
import { outsideTarget } from '../browser/outside-link.ts';
import { CheckIcon, ExternalLinkIcon, PlusIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';
import type { useCloudflareSetup } from './use-cloudflare.ts';

type Auto = ReturnType<typeof useCloudflareSetup>;

const PERMISSIONS: Record<
  CloudflareSharePermission,
  { title: string; detail: string; cloudflare: string }
> = {
  account: {
    title: 'See which account this is',
    detail: 'So Spark sets up the right account.',
    cloudflare: 'Account Settings: Read',
  },
  storage: {
    title: 'Create a storage bucket',
    detail: 'Shared pages are kept in it.',
    cloudflare: 'Workers R2 Storage: Edit',
  },
  workers: {
    title: 'Create the share service',
    detail:
      'Cloudflare’s smaller Workers permission can’t create one, so this covers every worker in the account. Spark creates spark-outpost-share and changes no other.',
    cloudflare: 'Workers: Admin',
  },
};

const PERMISSION_STATE = { needed: 'Needed', allowed: 'Allowed', missing: 'Not allowed' } as const;

const STEPS: Record<CloudflareSetupStepId, string> = {
  signIn: 'Sign in to Cloudflare',
  bucket: 'Create the storage bucket',
  worker: 'Create the share service',
  connect: 'Connect it to Spark',
};

const STEP_STATE = {
  todo: 'Waiting',
  working: 'Working…',
  done: 'Done',
  failed: 'Needs you',
} as const;

function OutsideLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="btn line sm" href={href} target={outsideTarget()} rel="noreferrer">
      {label}
      <ExternalLinkIcon />
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}

function Permissions({ setup }: { setup: CloudflareSetup }) {
  return (
    <ul className="cf-list" aria-label="What Spark asks Cloudflare for">
      {setup.permissions.map(({ id, state }) => (
        <li key={id} className="cf-item" data-state={state}>
          <span className="cf-mark" aria-hidden="true">
            {state === 'allowed' ? (
              <CheckIcon />
            ) : state === 'missing' ? (
              <WarnIcon />
            ) : (
              <PlusIcon />
            )}
          </span>
          <span className="cf-item-text">
            <b>{PERMISSIONS[id].title}</b>
            <span>{PERMISSIONS[id].detail}</span>
            <span>Cloudflare calls it {PERMISSIONS[id].cloudflare}.</span>
          </span>
          <span className="cf-state">{PERMISSION_STATE[state]}</span>
        </li>
      ))}
    </ul>
  );
}

function StepFix({ step, auto }: { step: CloudflareSetupStep; auto: Auto }) {
  if (step.fix === null) return null;
  return (
    <span className="cf-fix">
      {step.fix === 'cloudflare' && step.fixUrl && (
        <OutsideLink href={step.fixUrl} label="Open Cloudflare" />
      )}
      <button type="button" className="btn line sm" disabled={auto.busy} onClick={auto.start}>
        {step.fix === 'allow'
          ? 'Allow on Cloudflare'
          : step.fix === 'cloudflare'
            ? 'Check again'
            : 'Try again'}
      </button>
    </span>
  );
}

function Steps({ setup, auto }: { setup: CloudflareSetup; auto: Auto }) {
  return (
    <ol className="cf-list" aria-label="Set-up steps">
      {setup.steps.map((step) => (
        <li key={step.id} className="cf-item" data-state={step.state}>
          <span className="cf-mark" aria-hidden="true">
            {step.state === 'done' ? (
              <CheckIcon />
            ) : step.state === 'failed' ? (
              <WarnIcon />
            ) : step.state === 'working' ? (
              <SpinnerIcon />
            ) : null}
          </span>
          <span className="cf-item-text">
            <b>{STEPS[step.id]}</b>
            {step.problem && <span role="alert">{step.problem}</span>}
            {step.state === 'failed' && <StepFix step={step} auto={auto} />}
          </span>
          <span className="cf-state">{STEP_STATE[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}

function progressLine(setup: CloudflareSetup): string {
  const done = setup.steps.filter((step) => step.state === 'done').length;
  const account = setup.account ? ` in ${setup.account}` : '';
  if (setup.status === 'waiting') return 'Waiting for you to allow Spark in Cloudflare.';
  if (setup.status === 'stopped') {
    return `${done} of ${setup.steps.length} steps done${account}. Finished steps are kept.`;
  }
  const active = setup.steps.find((step) => step.state === 'working');
  const doing = active ? `: ${STEPS[active.id].toLowerCase()}` : '';
  return `Setting up${account}${doing}. ${done} of ${setup.steps.length} steps done.`;
}

export function CloudflareAuto({ setup, auto }: { setup: CloudflareSetup; auto: Auto }) {
  const headingId = useId();
  const started = setup.status !== 'idle';
  return (
    <section className="cf-auto" aria-labelledby={headingId}>
      <h4 id={headingId}>Set it up for me</h4>
      {started ? (
        <>
          <p role="status">{progressLine(setup)}</p>
          <Steps setup={setup} auto={auto} />
          {setup.signedIn && setup.status === 'stopped' && (
            <p>
              Spark stays signed in to Cloudflare for up to an hour so it can carry on. Start over
              ends the sign-in now.
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            Sign in to Cloudflare once and Spark creates the share service in your account. About 2
            minutes.
          </p>
          <Permissions setup={setup} />
          <p>
            Spark asks for nothing else and ends the sign-in when set-up finishes. After that it
            keeps no access to your Cloudflare account.
          </p>
        </>
      )}
      {auto.error && (
        <p className="gh-err" role="alert">
          {auto.error.message}
        </p>
      )}
      <div className="cx-actions">
        {!started && (
          <button
            type="button"
            className="btn primary sm"
            disabled={auto.busy}
            onClick={auto.start}
          >
            Allow on Cloudflare
            <ExternalLinkIcon />
            <span className="sr-only"> (opens in your browser)</span>
          </button>
        )}
        {setup.status === 'waiting' && setup.authorizeUrl && (
          <OutsideLink href={setup.authorizeUrl} label="Open Cloudflare again" />
        )}
        {started && (
          <button type="button" className="btn ghost sm" disabled={auto.busy} onClick={auto.cancel}>
            {setup.status === 'stopped' ? 'Start over' : 'Cancel'}
          </button>
        )}
      </div>
    </section>
  );
}
