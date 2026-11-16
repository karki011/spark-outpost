import type { ConversationSummary } from '@spark-outpost/contracts';
import { HomeRow, HomeRows, StatusLabel, type StatusTone } from './HomeCards.tsx';
import { RowButtons, RowError } from './RowButtons.tsx';
import type { FeedRow, FeedSeverity } from './needs-model.ts';

const TONE: Record<FeedSeverity, StatusTone> = { warn: 'warn', bad: 'bad', done: 'ok' };
const WORD: Record<FeedSeverity, string> = { warn: 'Waiting', bad: 'Failed', done: 'Finished' };

interface NeedsFeedProps {
  rows: readonly FeedRow[];
  onOpen: (chat: ConversationSummary) => void;
}

export function NeedsFeed({ rows, onOpen }: NeedsFeedProps) {
  return (
    <HomeRows label="Needs you">
      {rows.map((row, index) => {
        const { chat, action, sub } = row.item;
        return (
          <HomeRow
            key={chat.id}
            index={index}
            label={<StatusLabel word={WORD[row.severity]} tone={TONE[row.severity]} />}
            title={chat.title}
            line={
              <>
                {sub} · <span title={row.ageTitle}>{row.age}</span>
              </>
            }
            trailing={
              <RowButtons
                chat={chat}
                label={action}
                primary={row.primary}
                onOpen={() => onOpen(chat)}
              />
            }
          >
            <RowError chatId={chat.id} />
          </HomeRow>
        );
      })}
    </HomeRows>
  );
}
