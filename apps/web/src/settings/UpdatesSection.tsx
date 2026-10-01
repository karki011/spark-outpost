import { useId, useState } from 'react';
import { WAITING_FOR_RUNS, type UpdateChannel, type UpdateStatus } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { installMessage, useInstallUpdate } from '../desktop/use-install-update.ts';
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

const AUTO_DOWNLOAD = 'Download updates automatically';

export function updatesAvailable(): boolean {
  return Boolean(sparkDesktop()?.updates);
}

function phaseText(status: UpdateStatus): string {
  const version = status.availableVersion;
  if (status.waitingForRuns) return `${version} is ready. ${WAITING_FOR_RUNS}`;
  switch (status.phase) {
    case 'off':
      return status.offReason === 'dev'
        ? 'This dev copy never updates. Build a new one from your checkout.'
        : "Updates aren't set up in this build.";
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `${version} is available.`;
    case 'downloading':
      return `Downloading ${version}… ${status.progress ?? 0}%`;
    case 'ready':
      return `${version} is ready. It installs when you quit, or restart now.`;
    case 'installing':
      return `Installing ${version} and restarting…`;
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

function GetUpdateRow({ status }: { status: UpdateStatus }) {
  const hintId = useId();
  const install = useInstallUpdate();
  const [message, setMessage] = useState<string | null>(null);
  const busy = status.phase === 'installing' || status.installRequested;
  const ready = status.phase === 'ready';
  return (
    <SettingRow
      label={ready ? 'Update ready' : 'Update available'}
      hint={message ?? 'Running work is never interrupted.'}
      hintId={hintId}
    >
      <button
        type="button"
        className="btn primary sm"
        aria-describedby={hintId}
        disabled={busy}
        onClick={() => void install().then((result) => setMessage(installMessage(result)))}
      >
        {ready ? 'Restart to update' : 'Get the update'}
      </button>
    </SettingRow>
  );
}

function UpdateRows({ status }: { status: UpdateStatus }) {
  const versionHint = useId();
  const channelHint = useId();
  const checkHint = useId();
  const autoId = useId();
  const autoHint = useId();
  const [checking, setChecking] = useState(false);
  const updates = sparkDesktop()!.updates;
  const off = status.phase === 'off';
  const busy =
    checking ||
    status.phase === 'checking' ||
    status.phase === 'downloading' ||
    status.phase === 'installing';
  const offering = status.phase === 'ready' || status.phase === 'available';

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
          {offering && <GetUpdateRow status={status} />}
          <SettingRow
            label="Channel"
            doc={{ page: 'updates', heading: 'stable-or-beta' }}
            hint={CHANNEL_HINTS[status.channel]}
            hintId={channelHint}
          >
            <Segmented
              ariaLabel="Update channel"
              describedBy={channelHint}
              options={CHANNELS}
              value={status.channel}
              onChange={(id) => void updates.setChannel(id as UpdateChannel)}
            />
          </SettingRow>
          <SettingRow
            label={AUTO_DOWNLOAD}
            controlId={autoId}
            doc={{ page: 'updates', heading: 'download-updates-automatically' }}
            hint={
              status.autoDownload
                ? 'Updates download in the background; one click installs them.'
                : 'Off. Spark tells you about updates and downloads one when you ask.'
            }
            hintId={autoHint}
          >
            <BlobToggle
              id={autoId}
              label={AUTO_DOWNLOAD}
              kind="spark"
              checked={status.autoDownload}
              describedBy={autoHint}
              onChange={(on) => void updates.setAutoDownload(on)}
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
              {checking || status.phase === 'checking' ? 'Checking…' : 'Check now'}
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
        Spark Outpost gets updates in the background and installs them when you quit or restart. It
        never restarts while agents are working.
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
