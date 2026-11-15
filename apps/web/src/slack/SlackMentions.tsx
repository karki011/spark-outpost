import { HomeCard, HomeRow, HomeRows, RowAction, StatusLabel } from '../home/HomeCards.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import type { SlackMentionRow } from './slack-mentions-model.ts';

interface SlackMentionsProps {
  rows: readonly SlackMentionRow[];
  now: number;
  onRead: (key: string) => void;
  onDismiss: (key: string) => void;
}

export function SlackMentions({ rows, now, onRead, onDismiss }: SlackMentionsProps) {
  if (rows.length === 0) return null;
  return (
    <HomeCard id="home-slack-mentions" title="Slack mentions" count={rows.length}>
      <HomeRows label="Slack mentions">
        {rows.map((row, index) => (
          <HomeRow
            key={row.key}
            index={index}
            label={<StatusLabel word="Mention" tone="info" />}
            title={row.line}
            line={relativeTime(row.at, now)}
            trailing={
              <>
                {row.url && (
                  <a
                    className="btn sm line"
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open in Slack: ${row.line}`}
                    onClick={() => onRead(row.key)}
                  >
                    Open in Slack
                  </a>
                )}
                <RowAction
                  label="Dismiss"
                  name={`Dismiss: ${row.line}`}
                  onClick={() => onDismiss(row.key)}
                />
              </>
            }
          />
        ))}
      </HomeRows>
    </HomeCard>
  );
}
