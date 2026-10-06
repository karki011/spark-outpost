import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TailscaleState } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CopyIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { statusCopy } from './phone-copy.ts';

interface PhoneStatusProps {
  state: TailscaleState;
  wanted: boolean;
  connected: boolean;
  checking: boolean;
  onCheck: () => void;
}

const CAN_SWITCH = new Set<TailscaleState['status']>(['off', 'on', 'error']);

export function PhoneStatus({ state, wanted, connected, checking, onCheck }: PhoneStatusProps) {
  const queryClient = useQueryClient();
  const stepId = useId();
  const { state: copied, copy } = useCopyFeedback();
  const turn = useMutation({
    mutationFn: phoneApi.turn,
    onSuccess: (next) => {
      queryClient.setQueryData(phoneKeys.tailscale, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.all });
    },
  });
  const text = statusCopy(state);
  const on = state.status === 'on' || (state.status === 'error' && wanted);
  const failure = turn.error instanceof Error ? turn.error.message : null;

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
            label="Phone access"
            checked={on}
            disabled={turn.isPending}
            {...(text.step ? { describedBy: stepId } : {})}
            onChange={(next) => turn.mutate(next ? 'on' : 'off')}
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
              Phone connected
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
