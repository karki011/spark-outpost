import { useId } from 'react';
import type { TailscaleState } from '@spark-outpost/contracts';
import { statusHeadline } from './phone-copy.ts';
import { PhoneSetup, WhatYouGet } from './PhoneSetup.tsx';

interface PhoneStatusProps {
  state: TailscaleState;
  checking: boolean;
  turning: boolean;
  on: boolean;
  failure: string | null;
  onCheck: () => void;
  onTurn: (to: 'on' | 'off') => void;
}

const SETUP_NOTE =
  'Three steps, about five minutes. The work stays on this Mac and nothing is public.';

export function PhoneStatus({
  state,
  checking,
  turning,
  on,
  failure,
  onCheck,
  onTurn,
}: PhoneStatusProps) {
  const titleId = useId();
  return (
    <section className="ph-status-block" aria-labelledby={titleId}>
      <div className="ph-status">
        <div className="ph-status-text">
          <h2 id={titleId} className="ph-headline" data-status={state.status}>
            <i className="ph-dot" aria-hidden="true" />
            {statusHeadline(state, null)}
          </h2>
          <p className="ph-step">{SETUP_NOTE}</p>
        </div>
      </div>
      <PhoneSetup
        state={state}
        checking={checking}
        turning={turning}
        on={on}
        onCheck={onCheck}
        onTurn={onTurn}
      />
      <WhatYouGet />
      {failure && (
        <p className="ph-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
