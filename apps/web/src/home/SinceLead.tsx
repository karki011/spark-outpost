import { HomeLead, HomeRow, HomeRows, StatusLabel, type StatusTone } from './HomeCards.tsx';
import { RowButtons, RowError } from './RowButtons.tsx';
import { capRows, type SinceKind, type SinceRow } from './since-model.ts';

const WORD: Record<SinceKind, string> = {
  failed: 'Failed',
  waiting: 'Waiting',
  clean: 'Ready to merge',
  finished: 'Finished',
};
const TONE: Record<SinceKind, StatusTone> = {
  failed: 'bad',
  waiting: 'warn',
  clean: 'ok',
  finished: 'ok',
};
const ACTION: Record<SinceKind, string> = {
  failed: 'See error',
  waiting: 'Open chat',
  clean: 'Review',
  finished: 'Review',
};

interface SinceLeadProps {
  rows: readonly SinceRow[];
  onOpen: (row: SinceRow) => void;
}

export function SinceLead({ rows, onOpen }: SinceLeadProps) {
  const { shown, more } = capRows(rows);
  const next = more[0];
  return (
    <HomeLead
      id="home-lead-h"
      title="Since you left"
      meta={`${rows.length} ${rows.length === 1 ? 'item' : 'items'} to look at`}
    >
      <HomeRows label="Since you left">
        {shown.map((row, index) => (
          <HomeRow
            key={row.key}
            index={index}
            dim={!row.unread}
            label={<StatusLabel word={WORD[row.kind]} tone={TONE[row.kind]} />}
            title={row.chat.title}
            line={row.line}
            trailing={
              <RowButtons
                chat={row.chat}
                label={ACTION[row.kind]}
                primary={row.kind === 'failed' || row.kind === 'waiting'}
                onOpen={() => onOpen(row)}
              />
            }
          >
            <RowError chatId={row.chat.id} />
          </HomeRow>
        ))}
      </HomeRows>
      {next && (
        <p className="hlead-more">
          <button type="button" className="hlink" onClick={() => onOpen(next)}>
            {more.length} more · Open {next.chat.title}
          </button>
        </p>
      )}
    </HomeLead>
  );
}
