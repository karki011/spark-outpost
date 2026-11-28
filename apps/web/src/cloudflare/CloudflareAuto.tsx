import { useId } from 'react';
import type {
  CloudflareSetup,
  CloudflareSetupStepId,
  CloudflareSharePermission,
} from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import {
  OutsideLink,
  PermissionList,
  StepList,
  type PermissionCopy,
} from './CloudflareChecklist.tsx';
import type { useCloudflareSetup } from './use-cloudflare.ts';

type Auto = ReturnType<typeof useCloudflareSetup>;

const PERMISSIONS: Record<CloudflareSharePermission, PermissionCopy> = {
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
      'Cloudflare’s smaller Workers permission can’t create one, so this covers every worker in the account. Spark creates spark-outpost-artifact-share, or a numbered copy when the account already has one, and changes no other.',
    cloudflare: 'Workers: Admin',
  },
};

const STEPS: Record<CloudflareSetupStepId, string> = {
  signIn: 'Sign in to Cloudflare',
  bucket: 'Create the storage bucket',
  worker: 'Create the share service',
  connect: 'Connect it to Spark',
};

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
          <StepList steps={setup.steps} labels={STEPS} busy={auto.busy} onFix={auto.start} />
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
          <PermissionList permissions={setup.permissions} copy={PERMISSIONS} />
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
