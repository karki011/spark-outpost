import type { AdvisorConnection, AdvisorSetup } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { Detail } from './ConnectedSummary.tsx';
import { MoreMenu } from './MoreMenu.tsx';

const JEV_SENDS =
  'Your request, plan steps with their file paths, the end of each agent’s reply, and the titles of its recent tool calls. Never file contents, diffs, tool output or keys. TypeSafe does not train on it.';

interface AdvisorSummaryProps {
  advisor: AdvisorSetup;
  connection: AdvisorConnection;
  errorMessage: string | null;
  onChange: () => void;
  onDisconnect: () => void;
}

export function AdvisorSummary({
  advisor,
  connection,
  errorMessage,
  onChange,
  onDisconnect,
}: AdvisorSummaryProps) {
  return (
    <>
      <div className="conn-sum">
        <section className="conn-section" aria-label="Connection">
          <dl className="conn-details">
            <Detail term="Key">
              <code>{connection.detail}</code>
            </Detail>
            <Detail term="Checked">
              Verified with {advisor.maker} {relativeTime(connection.verifiedAt)}
            </Detail>
            <Detail term="Model">
              {connection.model ? (
                <code>{connection.model}</code>
              ) : (
                <span className="muted">—</span>
              )}
            </Detail>
            <Detail term="Role">
              {advisor.role}
              <small className="note">
                Used in runs while connected. A pinned model still runs as chosen.
              </small>
            </Detail>
            <Detail term="Sends">{JEV_SENDS}</Detail>
          </dl>
        </section>
        <div className="conn-actions">
          <MoreMenu
            label={`More ${advisor.name} actions`}
            actions={[
              { label: 'Change key', hint: 'Verify a new API key', onSelect: onChange },
              { label: 'Disconnect', danger: true, onSelect: onDisconnect },
            ]}
          />
        </div>
      </div>
      {errorMessage && <div className="hintline bad">{errorMessage}</div>}
    </>
  );
}
