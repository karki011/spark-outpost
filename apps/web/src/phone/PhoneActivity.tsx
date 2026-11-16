import { useState, type ReactNode } from 'react';
import type { RemoteAuditEntry } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { activityDetail, activityLine } from './phone-copy.ts';
import { PhoneSection } from './PhoneSection.tsx';
import { activitySummary } from './activity-summary.ts';

const PAGE = 12;

interface PhoneActivityProps {
  entries: RemoteAuditEntry[] | undefined;
  now: number;
  wait: ReactNode;
}

function Summary({ entries, now }: { entries: RemoteAuditEntry[]; now: number }) {
  const { refused, today, more } = activitySummary(entries, now);
  const plus = more ? '+' : '';
  return (
    <>
      {refused > 0 && (
        <span className="ph-pill warn">
          {refused}
          {plus} refused today
        </span>
      )}
      <span className="ph-count">{today === 0 ? 'Nothing today' : `${today}${plus} today`}</span>
    </>
  );
}

export function PhoneActivity({ entries, now, wait }: PhoneActivityProps) {
  const [shown, setShown] = useState(PAGE);
  return (
    <PhoneSection
      id="activity"
      title="Recent remote activity"
      initiallyOpen={false}
      summary={entries && <Summary entries={entries} now={now} />}
    >
      {entries === undefined && wait}
      {entries?.length === 0 && (
        <p className="ph-empty">Nothing yet. Pairing and every change a device makes show here.</p>
      )}
      {entries && entries.length > 0 && (
        <ol className="ph-activity">
          {entries.slice(0, shown).map((entry) => {
            const detail = activityDetail(entry);
            return (
              <li key={entry.id} data-action={entry.action}>
                <span className="ph-activity-line">{activityLine(entry)}</span>
                {detail && <code>{detail}</code>}
                <time dateTime={entry.at}>{relativeTime(entry.at)}</time>
              </li>
            );
          })}
        </ol>
      )}
      {entries && entries.length > shown && (
        <button type="button" className="btn ghost sm" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
    </PhoneSection>
  );
}
