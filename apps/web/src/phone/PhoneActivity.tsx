import { useState } from 'react';
import type { RemoteAuditEntry } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { activityDetail, activityLine } from './phone-copy.ts';

const PAGE = 12;

export function PhoneActivity({ entries }: { entries: RemoteAuditEntry[] }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <section className="ph-card" aria-labelledby="ph-activity-title">
      <h2 id="ph-activity-title">Recent phone activity</h2>
      {entries.length === 0 ? (
        <p className="ph-empty">Nothing yet. Pairing and every change a phone makes show here.</p>
      ) : (
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
      {entries.length > shown && (
        <button type="button" className="btn ghost sm" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      )}
    </section>
  );
}
