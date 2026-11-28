import './cloudflare-card.css';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { CloudflareConnection } from '@spark-outpost/contracts';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { DisconnectDialog } from '../connectors/DisconnectDialog.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { SettingRow } from '../settings/SettingRow.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { Switch } from '../ui/Switch.tsx';
import { WarningNote } from '../ui/WarningNote.tsx';
import { CloudflareSetup } from './CloudflareSetup.tsx';
import { useCloudflareActions, useCloudflareConnection } from './use-cloudflare.ts';

const CLOUDFLARE_DESCRIPTION = 'Share artifacts from your own Cloudflare account';

const CLOUDFLARE_DISCONNECT = {
  title: 'Disconnect Cloudflare?',
  text: 'Spark deletes the upload key from this computer’s keychain. Pages already shared stay up until they expire or you stop sharing them.',
};

const SHARE_SWITCH = 'Share artifacts from this account';

function Connected({ connection }: { connection: CloudflareConnection }) {
  const switchId = useId();
  const hintId = useId();
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const { update, check, disconnect } = useCloudflareActions();
  const busy = update.isPending || check.isPending || disconnect.isPending;
  const error = update.error ?? check.error ?? disconnect.error;
  const clear = () => {
    update.reset();
    check.reset();
    disconnect.reset();
  };
  const sharing = update.isPending ? update.variables.shareArtifacts : connection.shareArtifacts;
  return (
    <div className="cx-body cf-body">
      <dl className="cf-facts">
        <div>
          <dt>Status</dt>
          <dd className="cf-ok">
            <CheckIcon />
            Connected
          </dd>
        </div>
        <div>
          <dt>Service address</dt>
          <dd className="cf-host">{connection.host}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>
            <span role="status">
              {check.isPending
                ? 'Checking…'
                : connection.checkedAt
                  ? relativeTime(connection.checkedAt)
                  : 'Not yet'}
            </span>
            <button
              type="button"
              className="btn line sm"
              disabled={busy}
              onClick={() => {
                clear();
                check.mutate();
              }}
            >
              Check again
            </button>
          </dd>
        </div>
        <div>
          <dt>Pages shared now</dt>
          <dd>{connection.sharedNow}</dd>
        </div>
      </dl>
      {connection.problem && (
        <WarningNote lead="The last check found a problem.">{connection.problem}</WarningNote>
      )}
      <SettingRow
        label={SHARE_SWITCH}
        controlId={switchId}
        hint="Share… on an artifact uploads here."
        hintId={hintId}
      >
        <Switch
          id={switchId}
          label={SHARE_SWITCH}
          checked={sharing}
          describedBy={hintId}
          disabled={busy}
          onChange={(shareArtifacts) => {
            clear();
            update.mutate({ shareArtifacts });
          }}
        />
      </SettingRow>
      {error && (
        <p className="gh-err" role="alert">
          {error.message}
        </p>
      )}
      <p>
        Usage and any cost are on your Cloudflare account. Spark keeps the upload key in this
        computer’s keychain and no Cloudflare sign-in.
      </p>
      <div className="cx-actions">
        <button
          ref={disconnectRef}
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Disconnect…
        </button>
      </div>
      {confirming && (
        <DisconnectDialog
          copy={CLOUDFLARE_DISCONNECT}
          onCancel={() => {
            setConfirming(false);
            disconnectRef.current?.focus();
          }}
          onConfirm={() => {
            setConfirming(false);
            clear();
            disconnect.mutate();
          }}
        />
      )}
    </div>
  );
}

function statusLine(connection: CloudflareConnection | undefined): string {
  if (!connection?.connected) return CLOUDFLARE_DESCRIPTION;
  const host = connection.host ?? '';
  return connection.problem ? `${host} · Needs a look` : host;
}

interface CloudflareCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function CloudflareCard({ icon, open, onToggle }: CloudflareCardProps) {
  const { remote, session } = useRemoteClient();
  const status = useCloudflareConnection(session !== undefined && !remote);
  if (remote) return null;
  const connection = status.data;
  const connected = connection?.connected === true;
  return (
    <ConnectorCard
      connectorId="cloudflare"
      name="Cloudflare"
      icon={icon}
      status={statusLine(connection)}
      badge={status.isPending ? 'checking' : connected ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {connection &&
        (connected ? (
          <Connected connection={connection} />
        ) : (
          <CloudflareSetup deployUrl={connection.deployUrl} />
        ))}
    </ConnectorCard>
  );
}
