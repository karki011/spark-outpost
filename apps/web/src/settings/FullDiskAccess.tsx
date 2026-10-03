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

  const granted = status === 'granted';

  return (
    <section className="pcard fda-card" aria-label="Full Disk Access">
      <div className="pc-head">
        <span className="nm">
          <b>Full Disk Access</b>
          <small>Optional. Spark works without it.</small>
        </span>
        <DocLink
          topic="Full Disk Access"
          doc={{ page: 'mac-privacy', heading: 'full-disk-access' }}
        />
        {status && <StatusPill status={status} />}
      </div>
      <div className="pc-body">
        <p className="fda-lead">
          {granted
            ? 'Agents can read protected folders without macOS asking.'
            : 'Stops macOS asking each time an agent reads a protected folder.'}
        </p>
        <dl className="fda-facts">
          <div>
            <dt>With it</dt>
            <dd>
              Agents read <code>~/Library</code>, Desktop, Documents and Downloads without a macOS
              prompt.
            </dd>
          </div>
          <div>
            <dt>Without it</dt>
            <dd>macOS asks once per folder. You can allow each one as it comes up.</dd>
          </div>
          <div>
            <dt>Either way</dt>
            <dd>Spark's own approvals before a command or edit still apply.</dd>
          </div>
        </dl>
        {!granted && (
          <ol className="fda-steps">
            <li>
              Open <b>System Settings → Privacy &amp; Security → Full Disk Access</b>.
            </li>
            <li>
              Switch on <b>Spark Outpost</b>.
            </li>
            <li>Come back here. Spark checks again on its own.</li>
          </ol>
        )}
        {!granted &&
          (privacy ? (
            <button
              type="button"
              className="btn primary sm fda-open"
              onClick={() => void openSystemSettings()}
            >
              Open System Settings
            </button>
          ) : (
            <p className="fda-note">
              In a browser, open{' '}
              <HelpLink href={FULL_DISK_ACCESS_SYSTEM_SETTINGS_URL}>
                System Settings → Privacy &amp; Security → Full Disk Access
              </HelpLink>{' '}
              yourself.
            </p>
          ))}
      </div>
    </section>
  );
}
