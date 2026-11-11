import { useId } from 'react';
import type { TailscaleState } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CheckIcon, CopyIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { ON_NOTE, statusCopy, statusHeadline } from './phone-copy.ts';
import { PhoneSetup, WhatYouGet } from './PhoneSetup.tsx';
import { setupSteps } from './setup-steps.ts';

interface PhoneStatusProps {
  state: TailscaleState;
  wanted: boolean;
  connected: boolean;
  deviceCount: number | null;
  checking: boolean;
  turning: boolean;
  failure: string | null;
  onCheck: () => void;
  onTurn: (to: 'on' | 'off') => void;
}

const SETUP_NOTE =
  'Three steps, about five minutes. The work stays on this Mac and nothing is public.';

export function PhoneStatus({
  state,
  wanted,
  connected,
  deviceCount,
  checking,
  turning,
  failure,
  onCheck,
  onTurn,
}: PhoneStatusProps) {
  const stepId = useId();
  const titleId = useId();
  const { state: copied, copy } = useCopyFeedback();
  const text = statusCopy(state);
  const setup = setupSteps(state.status) !== null;
  const on = state.status === 'on' || (state.status === 'error' && wanted);
  const note = setup ? SETUP_NOTE : state.status === 'on' ? ON_NOTE : text.step;

  return (
    <section className="ph-status-block" aria-labelledby={titleId}>
      <div className="ph-status">
        <div className="ph-status-text">
          <h2 id={titleId} className="ph-headline" data-status={state.status}>
            <i className="ph-dot" aria-hidden="true" />
            {statusHeadline(state, deviceCount)}
          </h2>
          {note && (
            <p id={stepId} className="ph-step">
              {note}
            </p>
          )}
        </div>
        {!setup && (
          <BlobToggle
            label="Remote control"
            checked={on}
            disabled={turning}
            {...(note ? { describedBy: stepId } : {})}
            onChange={(next) => onTurn(next ? 'on' : 'off')}
          />
        )}
      </div>
      {setup && (
        <>
          <PhoneSetup
            state={state}
            checking={checking}
            turning={turning}
            on={on}
            onCheck={onCheck}
            onTurn={onTurn}
          />
          <WhatYouGet />
        </>
      )}
      {state.address && (
        <div className="ph-card ph-address">
          <span className="ph-address-label">Address</span>
          <code>{state.address}</code>
          {connected && (
            <span className="ph-connected">
              <CheckIcon />
              Device connected
            </span>
          )}
          <button type="button" className="btn line sm" onClick={() => copy(state.address ?? '')}>
            <CopyIcon />
            <span aria-live="polite">{copyButtonText(copied)}</span>
          </button>
        </div>
      )}
      {failure && (
        <p className="ph-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
