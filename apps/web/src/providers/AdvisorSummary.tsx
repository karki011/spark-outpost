import type { AdvisorConnection, AdvisorSetup } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { Detail } from './ConnectedSummary.tsx';
import { MoreMenu } from './MoreMenu.tsx';

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
              <small className="note">Not used in runs yet. Chats keep your chosen provider.</small>
            </Detail>
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
