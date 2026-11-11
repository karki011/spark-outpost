import { useId, type ReactNode } from 'react';
import type { TailscaleState } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CheckIcon, ClockIcon, ExternalLinkIcon, WarnIcon } from '../ui/icons.tsx';
import { statusCopy } from './phone-copy.ts';
import {
  setupSteps,
  STEP_STATE_WORDS,
  type SetupStep,
  type SetupStepState,
} from './setup-steps.ts';

const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download';
const NOT_CONNECTED = 'Installed but not connected? Open Tailscale, sign in and connect.';

interface PhoneSetupProps {
  state: TailscaleState;
  checking: boolean;
  turning: boolean;
  on: boolean;
  onCheck: () => void;
  onTurn: (to: 'on' | 'off') => void;
}

function StepIcon({ state }: { state: SetupStepState }) {
  if (state === 'done') return <CheckIcon />;
  if (state === 'needs_you') return <WarnIcon />;
  return <ClockIcon />;
}

function LinkButton({ href, label, primary }: { href: string; label: string; primary: boolean }) {
  return (
    <a
      className={primary ? 'btn primary sm' : 'btn line sm'}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
      <ExternalLinkIcon />
    </a>
  );
}

function CheckAgain({ checking, onCheck }: { checking: boolean; onCheck: () => void }) {
  return (
    <button type="button" className="btn line sm" disabled={checking} onClick={onCheck}>
      {checking ? 'Checking…' : 'Check again'}
    </button>
  );
}

function StepCard({
  step,
  title,
  text,
  textId,
  children,
}: {
  step: SetupStep;
  title: string;
  text: string;
  textId?: string;
  children?: ReactNode;
}) {
  const headingId = useId();
  const number = ['tailscale', 'https', 'turn-on'].indexOf(step.id) + 1;
  return (
    <li className="ph-step-card" data-state={step.state} aria-labelledby={headingId}>
      <span className="ph-step-state">
        <StepIcon state={step.state} />
        Step {number} · {STEP_STATE_WORDS[step.state]}
      </span>
      <h3 id={headingId}>{title}</h3>
      <p id={textId} className="ph-note">
        {text}
      </p>
      {children && <div className="ph-step-actions">{children}</div>}
    </li>
  );
}

function TailscaleStep({ step, props }: { step: SetupStep; props: PhoneSetupProps }) {
  const { state, checking, onCheck } = props;
  if (step.state === 'done') {
    return <StepCard step={step} title="Tailscale on this Mac" text="Installed and signed in." />;
  }
  const missing = state.status === 'not_installed';
  const text = statusCopy(state).step ?? '';
  return (
    <StepCard step={step} title={missing ? 'Get Tailscale' : 'Tailscale on this Mac'} text={text}>
      {missing && <LinkButton href={TAILSCALE_DOWNLOAD} label="Download Tailscale" primary />}
      <CheckAgain checking={checking} onCheck={onCheck} />
      {missing && <p className="ph-note ph-step-aside">{NOT_CONNECTED}</p>}
    </StepCard>
  );
}

function HttpsStep({ step, props }: { step: SetupStep; props: PhoneSetupProps }) {
  const { state, checking, onCheck } = props;
  const title = 'Turn on HTTPS certificates';
  if (step.state === 'done') {
    return <StepCard step={step} title={title} text="HTTPS certificates are on." />;
  }
  if (step.state === 'next' || step.state === 'later') {
    return (
      <StepCard
        step={step}
        title={title}
        text="One switch in the Tailscale admin console, under DNS."
      />
    );
  }
  const link = statusCopy(state).link;
  return (
    <StepCard step={step} title={title} text={statusCopy(state).step ?? ''}>
      {link && <LinkButton href={link.href} label={link.label} primary />}
      <CheckAgain checking={checking} onCheck={onCheck} />
    </StepCard>
  );
}

function TurnOnStep({ step, props }: { step: SetupStep; props: PhoneSetupProps }) {
  const describedBy = useId();
  const { state, turning, on, onTurn } = props;
  const title = 'Turn on and pair a device';
  if (state.status !== 'off') {
    return (
      <StepCard
        step={step}
        title={title}
        text="Scan a code with your phone, then confirm the matching code here. Only a device you confirm on this Mac gets in."
      />
    );
  }
  return (
    <StepCard step={step} title={title} text={statusCopy(state).step ?? ''} textId={describedBy}>
      <BlobToggle
        label="Remote control"
        checked={on}
        disabled={turning}
        describedBy={describedBy}
        onChange={(next) => onTurn(next ? 'on' : 'off')}
      />
    </StepCard>
  );
}

export function PhoneSetup(props: PhoneSetupProps) {
  const steps = setupSteps(props.state.status);
  if (!steps) return null;
  const [first, second, third] = steps;
  if (!first || !second || !third) return null;
  return (
    <ol className="ph-steps" aria-label="Set up remote control">
      <TailscaleStep step={first} props={props} />
      <HttpsStep step={second} props={props} />
      <TurnOnStep step={third} props={props} />
    </ol>
  );
}

const WHAT_YOU_GET: { label: string; text: string }[] = [
  {
    label: 'From your phone',
    text: 'Read chats, send messages, answer approval cards, follow outposts, and get a notification when a chat needs you.',
  },
  {
    label: 'You choose',
    text: 'Switches grouped by risk, so you can turn off what you do not need.',
  },
  {
    label: 'Only on this Mac',
    text: 'The Browser pane, preview, shell tabs, calendar, voice, Mac control, pairing and these switches.',
  },
];

export function WhatYouGet() {
  const headingId = useId();
  return (
    <div className="ph-card ph-what" role="group" aria-labelledby={headingId}>
      <h3 id={headingId}>What you get, and what stays here</h3>
      <dl>
        {WHAT_YOU_GET.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
