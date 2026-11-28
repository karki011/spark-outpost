import './cloudflare-card.css';
import { outsideTarget } from '../browser/outside-link.ts';
import { CheckIcon, ExternalLinkIcon, PlusIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';

export interface PermissionCopy {
  title: string;
  detail: string;
  cloudflare: string;
}

type PermissionState = 'needed' | 'allowed' | 'missing';
type StepState = 'todo' | 'working' | 'done' | 'failed';

export interface ChecklistStep<Id extends string> {
  id: Id;
  state: StepState;
  problem: string | null;
  fix: 'allow' | 'retry' | 'cloudflare' | null;
  fixUrl: string | null;
}

const PERMISSION_STATE = { needed: 'Needed', allowed: 'Allowed', missing: 'Not allowed' } as const;
const STEP_STATE = {
  todo: 'Waiting',
  working: 'Working…',
  done: 'Done',
  failed: 'Needs you',
} as const;

export function OutsideLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="btn line sm" href={href} target={outsideTarget()} rel="noreferrer">
      {label}
      <ExternalLinkIcon />
      <span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}

interface PermissionListProps<Id extends string> {
  permissions: { id: Id; state: PermissionState }[];
  copy: Record<Id, PermissionCopy>;
}

export function PermissionList<Id extends string>({ permissions, copy }: PermissionListProps<Id>) {
  return (
    <ul className="cf-list" aria-label="What Spark asks Cloudflare for">
      {permissions.map(({ id, state }) => (
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
            <b>{copy[id].title}</b>
            <span>{copy[id].detail}</span>
            <span>Cloudflare calls it {copy[id].cloudflare}.</span>
          </span>
          <span className="cf-state">{PERMISSION_STATE[state]}</span>
        </li>
      ))}
    </ul>
  );
}

interface StepListProps<Id extends string> {
  steps: ChecklistStep<Id>[];
  labels: Record<Id, string>;
  busy: boolean;
  onFix: () => void;
}

function StepFix<Id extends string>({
  step,
  busy,
  onFix,
}: {
  step: ChecklistStep<Id>;
  busy: boolean;
  onFix: () => void;
}) {
  if (step.fix === null) return null;
  return (
    <span className="cf-fix">
      {step.fix === 'cloudflare' && step.fixUrl && (
        <OutsideLink href={step.fixUrl} label="Open Cloudflare" />
      )}
      <button type="button" className="btn line sm" disabled={busy} onClick={onFix}>
        {step.fix === 'allow'
          ? 'Allow on Cloudflare'
          : step.fix === 'cloudflare'
            ? 'Check again'
            : 'Try again'}
      </button>
    </span>
  );
}

export function StepList<Id extends string>({ steps, labels, busy, onFix }: StepListProps<Id>) {
  return (
    <ol className="cf-list" aria-label="Set-up steps">
      {steps.map((step) => (
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
            <b>{labels[step.id]}</b>
            {step.problem && <span role="alert">{step.problem}</span>}
            {step.state === 'failed' && <StepFix step={step} busy={busy} onFix={onFix} />}
          </span>
          <span className="cf-state">{STEP_STATE[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}
