import { useId, useState } from 'react';
import type { UpdateChannel, UpdateStatus } from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useInstallUpdate } from '../desktop/use-install-update.ts';
import { useUpdateStatus } from '../desktop/use-update-status.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { SettingRow } from './SettingRow.tsx';
import '../desktop/updates.css';

const CHANNELS = [
  { id: 'stable', label: 'Stable' },
  { id: 'beta', label: 'Beta' },
];

const CHANNEL_HINTS: Record<UpdateChannel, string> = {
  stable: 'Tested releases only.',
  beta: 'New features a little earlier. They can be rougher, and Stable releases still arrive.',
};

export function updatesAvailable(): boolean {
  return Boolean(sparkDesktop()?.updates);
}

function offText(status: UpdateStatus): string {
  return status.offReason === 'dev'
    ? 'This dev copy never updates. Build a new one from your checkout.'
    : "Updates aren't set up in this build.";
}

function phaseText(status: UpdateStatus): string {
  switch (status.phase) {
    case 'off':
      return offText(status);
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading ${status.availableVersion}… ${status.progress ?? 0}%`;
    case 'ready':
      return `${status.availableVersion} is ready. It installs when you quit, or restart now.`;
    case 'error':
      return `Couldn't check for updates. ${status.error ?? ''}`.trim();
    case 'idle':
      return status.lastCheckedAt
        ? "You're up to date."
        : 'Spark checks when it starts and every 4 hours.';
  }
}

function checkedText(status: UpdateStatus): string {
  const checked = status.lastCheckedAt
    ? `Last checked ${relativeTime(status.lastCheckedAt)}.`
    : 'Not checked yet.';
  const skipped = status.skippedVersion
    ? ` Skipped ${status.skippedVersion} because it couldn't update your data.`
    : '';
  return checked + skipped;
}

function UpdateRows({ status }: { status: UpdateStatus }) {
  const versionHint = useId();
  const channelHint = useId();
  const checkHint = useId();
  const restartHint = useId();
  const [checking, setChecking] = useState(false);
  const { install, blocked, starting } = useInstallUpdate();
  const updates = sparkDesktop()!.updates;
  const off = status.phase === 'off';
  const busy = checking || status.phase === 'checking' || status.phase === 'downloading';

  const checkNow = async () => {
    setChecking(true);
    await updates.check();
    setChecking(false);
  };

  return (
    <>
      <SettingRow label="Version" hint={phaseText(status)} hintId={versionHint}>
        <span className="upd-version">Spark Outpost {status.currentVersion}</span>
      </SettingRow>
      {!off && (
        <>
          {status.phase === 'ready' && (
            <SettingRow
              label="Update ready"
              hint={blocked ?? 'Running work is never interrupted.'}
              hintId={restartHint}
            >
              <button
                type="button"
                className="btn primary sm"
                aria-describedby={restartHint}
                disabled={starting}
                onClick={() => void install()}
              >
                Restart to update
              </button>
            </SettingRow>
          )}
          <SettingRow label="Channel" hint={CHANNEL_HINTS[status.channel]} hintId={channelHint}>
            <Segmented
              ariaLabel="Update channel"
              describedBy={channelHint}
              options={CHANNELS}
              value={status.channel}
              onChange={(id) => void updates.setChannel(id as UpdateChannel)}
            />
          </SettingRow>
          <SettingRow label="Check for updates" hint={checkedText(status)} hintId={checkHint}>
            <button
              type="button"
              className="btn line sm"
              aria-describedby={checkHint}
              disabled={busy}
              onClick={() => void checkNow()}
            >
              {busy ? 'Checking…' : 'Check now'}
            </button>
          </SettingRow>
        </>
      )}
      {status.releaseNotesUrl && (
        <p className="set-hint upd-notes">
          <a href={status.releaseNotesUrl} target="_blank" rel="noreferrer">
            Release notes
          </a>
        </p>
      )}
    </>
  );
}

export function UpdatesSection() {
  const status = useUpdateStatus();
  return (
    <>
      <p className="lede">
        Spark Outpost downloads updates in the background and installs them when you quit or
        restart. It never restarts while agents are working.
      </p>
      {status ? (
        <UpdateRows status={status} />
      ) : (
        <div className="upd-skeleton" aria-busy="true" aria-label="Loading updates">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
    </>
  );
}
