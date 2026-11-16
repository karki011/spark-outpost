import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RemoteDevice, RemoteSwitches, TailscaleState } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { CheckIcon, CopyIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { ON_NOTE, statusCopy, statusHeadline } from './phone-copy.ts';
import { QrCode } from './QrCode.tsx';
import { groupCount, shownGroups } from './switch-groups.ts';

interface PhoneRailProps {
  state: TailscaleState;
  wanted: boolean;
  devices: RemoteDevice[] | undefined;
  switches: RemoteSwitches;
  lastRequest: string | null;
  turning: boolean;
  failure: string | null;
  onTurn: (to: 'on' | 'off') => void;
}

function Fact({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="ph-fact">
      <dt>{label}</dt>
      <dd>
        {on !== undefined && <i className="ph-fact-dot" data-on={on} aria-hidden="true" />}
        {value}
      </dd>
    </div>
  );
}

function Address({ address, connected }: { address: string; connected: boolean }) {
  const { state: copied, copy } = useCopyFeedback();
  const [qr, setQr] = useState(false);
  const qrId = useId();
  return (
    <div className="ph-rail-part ph-address">
      <span className="ph-address-label">Address</span>
      <code>{address}</code>
      {connected && (
        <span className="ph-connected">
          <CheckIcon />
          Device connected
        </span>
      )}
      <div className="ph-address-actions">
        <button type="button" className="btn line sm" onClick={() => copy(address)}>
          <CopyIcon />
          <span aria-live="polite">{copyButtonText(copied)}</span>
        </button>
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={qr}
          aria-controls={qrId}
          onClick={() => setQr(!qr)}
        >
          {qr ? 'Hide QR code' : 'Show QR code'}
        </button>
      </div>
      <div id={qrId} className="ph-address-qr" hidden={!qr}>
        {qr && <QrCode text={address} label="QR code for this Mac's address" />}
      </div>
    </div>
  );
}

function DisconnectAll() {
  const queryClient = useQueryClient();
  const disconnect = useMutation({
    mutationFn: phoneApi.disconnectAll,
    onSuccess: (next) => {
      queryClient.setQueryData(phoneKeys.devices, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  return (
    <div className="ph-rail-part">
      <HoldToConfirm
        label="Hold to disconnect all"
        hint="Every device will need to pair again. Their passkeys are removed too."
        holdingHint="Keep holding. Let go now to cancel."
        releasedHint="Released early. Nothing happened."
        disabled={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
      {disconnect.error && (
        <p className="ph-error" role="alert">
          {disconnect.error.message}
        </p>
      )}
    </div>
  );
}

export function PhoneRail({
  state,
  wanted,
  devices,
  switches,
  lastRequest,
  turning,
  failure,
  onTurn,
}: PhoneRailProps) {
  const stepId = useId();
  const titleId = useId();
  const glanceId = useId();
  const active = (devices ?? []).filter((device) => !device.revokedAt);
  const online = active.filter((device) => device.connected).length;
  const on = state.status === 'on' || (state.status === 'error' && wanted);
  const note = state.status === 'on' ? ON_NOTE : statusCopy(state).step;
  const risky = shownGroups().find((group) => group.id === 'high-risk');

  return (
    <aside className="ph-rail" aria-labelledby={titleId}>
      <div className="ph-rail-part ph-rail-status">
        <div className="ph-status">
          <h2 id={titleId} className="ph-headline" data-status={state.status}>
            <i className="ph-dot" aria-hidden="true" />
            {statusHeadline(state, devices ? active.length : null)}
          </h2>
          <BlobToggle
            label="Remote control"
            checked={on}
            disabled={turning}
            {...(note ? { describedBy: stepId } : {})}
            onChange={(next) => onTurn(next ? 'on' : 'off')}
          />
        </div>
        {note && (
          <p id={stepId} className="ph-step">
            {note}
          </p>
        )}
        {failure && (
          <p className="ph-error" role="alert">
            {failure}
          </p>
        )}
      </div>
      {state.address && <Address address={state.address} connected={online > 0} />}
      <div className="ph-rail-part">
        <h3 id={glanceId}>At a glance</h3>
        <dl className="ph-facts" aria-labelledby={glanceId}>
          <Fact label="Paired" value={devices ? String(active.length) : '…'} />
          <Fact label="Online now" value={online > 0 ? String(online) : 'None'} on={online > 0} />
          <Fact
            label="Notifications"
            value={switches.notifications ? 'On' : 'Off'}
            on={switches.notifications}
          />
          {risky && (
            <Fact
              label="High risk"
              value={groupCount(risky.switches, switches)}
              on={risky.switches.some((id) => switches[id])}
            />
          )}
          <Fact label="Last request" value={lastRequest ? relativeTime(lastRequest) : 'None yet'} />
        </dl>
      </div>
      {active.length > 0 && <DisconnectAll />}
    </aside>
  );
}
