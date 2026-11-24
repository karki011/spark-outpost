import type { ReactNode } from 'react';
import type { ZoomStatus } from '@spark-outpost/contracts';
import { outsideTarget } from '../browser/outside-link.ts';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { useZoom, useZoomStatus } from './use-zoom.ts';

export const ZOOM_PRIVACY_LINE =
  'Spark only creates and deletes meetings it made for your events. The sign-in stays in your keychain, so you sign in once.';

function statusLine(status: ZoomStatus): string {
  if (!status.account) return 'Add a Zoom link to events you create';
  return status.account.needsSignIn ? 'Sign in again' : status.account.email;
}

function Waiting({ status, onCancel }: { status: ZoomStatus; onCancel: () => void }) {
  return (
    <div className="cal-google-wait" role="group" aria-label="Zoom sign-in">
      <p className="gh-note">
        Finish in your browser: Zoom asks you to allow Spark Outpost to create meetings, then sends
        you back here.
      </p>
      <div className="cx-actions">
        {status.signIn.authorizeUrl && (
          <a
            className="btn line sm"
            href={status.signIn.authorizeUrl}
            target={outsideTarget()}
            rel="noreferrer"
          >
            Open Zoom again
            <ExternalLinkIcon />
          </a>
        )}
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="gh-state warn" role="status">
        Waiting for you to finish in Zoom
      </p>
    </div>
  );
}

function Body({ status }: { status: ZoomStatus }) {
  const zoom = useZoom(status);
  const account = status.account;
  return (
    <div className="cx-body">
      {account && (
        <p className="gh-note">
          {account.needsSignIn
            ? `Zoom ended the sign-in for ${account.email}. Sign in again to keep adding Zoom links.`
            : `Signed in as ${account.email}. New event can add a Zoom link.`}
        </p>
      )}
      {zoom.waiting ? (
        <Waiting status={status} onCancel={zoom.cancel} />
      ) : (
        <div className="cx-actions">
          {(!account || account.needsSignIn) && (
            <button
              type="button"
              className="btn primary sm"
              disabled={zoom.busy}
              onClick={zoom.connect}
            >
              {account ? 'Sign in again' : 'Connect'}
            </button>
          )}
          {account && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={zoom.busy}
              onClick={zoom.disconnect}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
      {[zoom.flowNote, zoom.note, zoom.error?.message ?? null].map(
        (line, index) =>
          line && (
            <p key={index} className="gh-err" role="alert">
              {line}
            </p>
          ),
      )}
      <p className="cal-muted">{ZOOM_PRIVACY_LINE}</p>
    </div>
  );
}

interface ZoomCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function ZoomCard({ icon, open, onToggle }: ZoomCardProps) {
  const status = useZoomStatus().data;
  if (!status?.available) return null;
  const ready = status.account !== null && !status.account.needsSignIn;
  return (
    <ConnectorCard
      connectorId="zoom"
      name="Zoom"
      icon={icon}
      status={statusLine(status)}
      badge={ready ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      <Body status={status} />
    </ConnectorCard>
  );
}
