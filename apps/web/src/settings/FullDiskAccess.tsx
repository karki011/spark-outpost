import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL,
  type FullDiskAccessStatusValue,
} from '@spark-outpost/contracts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { HelpLink } from '../tickets/TicketConnectForm.tsx';
import { DocLink } from '../ui/DocLink.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { fullDiskAccessQuery } from './full-disk-access-status.ts';
import '../providers/providers.css';
import './full-disk-access.css';

function StatusPill({ status }: { status: FullDiskAccessStatusValue }) {
  if (status === 'granted') {
    return (
      <span className="pill-ok">
        <CheckIcon />
        Granted
      </span>
    );
  }
  if (status === 'not_granted') return <span className="fda-pill">Not yet</span>;
  if (status === 'unknown') return <span className="fda-pill">Can't tell</span>;
  return null;
}

export function FullDiskAccess() {
  const query = useQuery(fullDiskAccessQuery);
  const queryClient = useQueryClient();
  const status = query.data?.status;
  const privacy = sparkDesktop()?.privacy;

  if (status === 'unsupported') return null;

  async function openSystemSettings() {
    if (privacy) await privacy.openFullDiskAccess();
    await queryClient.invalidateQueries({ queryKey: fullDiskAccessQuery.queryKey });
  }

  return (
    <section className="pcard fda-card" aria-label="Full Disk Access">
      <div className="pc-head">
        <span className="nm">
          <b>Let Spark read everywhere on your Mac (Full Disk Access)</b>
          <small>Optional. Spark works without it.</small>
        </span>
        <DocLink
          topic="Full Disk Access"
          doc={{ page: 'privacy-and-secrets', heading: 'full-disk-access-on-mac' }}
        />
        {status && <StatusPill status={status} />}
      </div>
      <div className="pc-body">
        <p>
          With Full Disk Access, Spark's agents can read files in protected folders like{' '}
          <code>~/Library</code>, Desktop, Documents and Downloads without macOS asking every time.
        </p>
        <p>
          macOS doesn't let apps turn this on themselves, so the button opens{' '}
          <b>System Settings → Privacy &amp; Security → Full Disk Access</b>, where you switch on{' '}
          <b>Spark Outpost</b>.
        </p>
        <p>
          Without it, macOS may ask once per folder (Desktop, Documents or Downloads) the first time
          an agent reads there. You can allow those individually instead of granting Full Disk
          Access.
        </p>
        <p className="fda-note">
          Full Disk Access only stops macOS's own file-access prompts. It does not replace Spark's
          own approvals before a command or edit runs.
        </p>
        {privacy ? (
          <button type="button" className="btn line sm" onClick={() => void openSystemSettings()}>
            Open System Settings
          </button>
        ) : (
          <p className="fda-note">
            In a browser, open{' '}
            <HelpLink href={FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL}>
              System Settings → Privacy &amp; Security → Full Disk Access
            </HelpLink>{' '}
            and switch on Spark Outpost.
          </p>
        )}
      </div>
    </section>
  );
}
