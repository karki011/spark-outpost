import { useId } from 'react';
import type { TailscaleState } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CopyIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { statusCopy } from './phone-copy.ts';

interface PhoneStatusProps {
  state: TailscaleState;
  wanted: boolean;
  connected: boolean;
  checking: boolean;
  turning: boolean;
  failure: string | null;
  onCheck: () => void;
  onTurn: (to: 'on' | 'off') => void;
}

const CAN_SWITCH = new Set<TailscaleState['status']>(['off', 'on', 'error']);

export function PhoneStatus({
  state,
  wanted,
  connected,
  checking,
  turning,
  failure,
  onCheck,
  onTurn,
}: PhoneStatusProps) {
  const stepId = useId();
  const { state: copied, copy } = useCopyFeedback();
  const text = statusCopy(state);
  const on = state.status === 'on' || (state.status === 'error' && wanted);

  return (
    <section className="ph-card" aria-labelledby="ph-status-title">
      <div className="ph-status">
        <div className="ph-status-text">
          <h2 id="ph-status-title" data-status={state.status}>
            <i className="ph-dot" aria-hidden="true" />
            {text.title}
          </h2>
          {text.step && (
            <p id={stepId} className="ph-step">
              {text.step}
            </p>
          )}
        </div>
        {CAN_SWITCH.has(state.status) ? (
          <BlobToggle
            label="Remote control"
            checked={on}
            disabled={turning}
            {...(text.step ? { describedBy: stepId } : {})}
            onChange={(next) => onTurn(next ? 'on' : 'off')}
          />
        ) : (
          <button type="button" className="btn line sm" disabled={checking} onClick={onCheck}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        )}
      </div>
      {text.link && (
        <a className="ph-link" href={text.link.href} target="_blank" rel="noreferrer">
          {text.link.label}
          <ExternalLinkIcon />
        </a>
      )}
      {state.address && (
        <div className="ph-address">
          <span className="ph-address-label">Address</span>
          <code>{state.address}</code>
          <button type="button" className="btn ghost sm" onClick={() => copy(state.address ?? '')}>
            <CopyIcon />
            <span aria-live="polite">{copyButtonText(copied)}</span>
          </button>
          {connected && (
            <span className="ph-connected">
              <i className="ph-dot" aria-hidden="true" />
              Device connected
            </span>
          )}
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
