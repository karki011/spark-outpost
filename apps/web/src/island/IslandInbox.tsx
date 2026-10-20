import './island-inbox.css';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import { TickIcon } from '../ui/icons.tsx';
import { InboxCard } from './InboxCard.tsx';
import { InboxMeeting } from './InboxMeeting.tsx';
import {
  AsideRows,
  CalendarRow,
  calendarRow,
  FinishedRows,
  RunningRows,
  Section,
} from './InboxRows.tsx';
import { finishedRows, runningRows, topAnswerable } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { chatAgent } from './use-island-data.ts';
import type { Decided } from './use-decide.ts';

export interface InboxBundle {
  chats: readonly ConversationSummary[];
  cards: readonly Card[];
  aside: readonly Card[];
  details: ReadonlyMap<string, ConversationDetail>;
  onLater: (card: Card) => void;
  onReview: (card: Card) => void;
  onDecided: (decided: Decided) => void;
  onConnectors: (() => void) | null;
}

interface IslandInboxProps {
  inbox: InboxBundle;
  calendar: IslandCalendar;
  now: number;
  onOpenChat: (id: string) => void;
}

function useClearFinished() {
  const client = useQueryClient();
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const clear = (id: string) => {
    setCleared((current) => new Set(current).add(id));
    void api
      .markConversationSeen(id)
      .then(() => client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }))
      .catch(() =>
        setCleared((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      );
  };
  return { cleared, clear };
}

function GitHubNote({ onConnectors }: { onConnectors: (() => void) | null }) {
  const health = useQuery({ queryKey: homeKeys.health, queryFn: homeApi.health });
  if (!health.data?.githubSignInNeeded) return null;
  return (
    <p className="isl-hnote" role="status">
      <span>GitHub sign-in ended. Runs keep going with your other logins.</span>
      {onConnectors && (
        <button type="button" className="isl-hnote-act" onClick={onConnectors}>
          Sign in again
        </button>
      )}
    </p>
  );
}

export function IslandInbox({ inbox, calendar, now, onOpenChat }: IslandInboxProps) {
  const { cleared, clear } = useClearFinished();
  const running = useMemo(
    () => runningRows(inbox.chats, inbox.details),
    [inbox.chats, inbox.details],
  );
  const finished = useMemo(() => finishedRows(inbox.chats, cleared), [inbox.chats, cleared]);
  const top = topAnswerable(inbox.cards);
  const line = calendarRow(calendar.line);
  const waiting = inbox.cards.length + inbox.aside.length + (line ? 1 : 0);
  return (
    <div className="isl-inbox">
      <GitHubNote onConnectors={inbox.onConnectors} />
      <InboxMeeting calendar={calendar} />
      <Section id="isl-needs-h" label="Needs you" count={waiting}>
        {inbox.cards.map((card) => (
          <InboxCard
            key={card.approval?.id ?? card.chat.id}
            card={card}
            agent={chatAgent(card.chat, inbox.details.get(card.chat.id)).name}
            now={now}
            top={card === top}
            onDecided={inbox.onDecided}
            onLater={inbox.onLater}
            onReview={inbox.onReview}
            onOpenChat={onOpenChat}
          />
        ))}
        {line && <CalendarRow line={line} calendar={calendar} />}
        <AsideRows cards={inbox.aside} now={now} onOpenChat={onOpenChat} />
        {waiting === 0 && (
          <li className="isl-inbox-quiet">
            <TickIcon />
            Nothing needs you
          </li>
        )}
      </Section>
      {running.length > 0 && (
        <Section id="isl-running-h" label="Running" count={running.length}>
          <RunningRows rows={running} now={now} onOpenChat={onOpenChat} />
        </Section>
      )}
      {finished.length > 0 && (
        <Section id="isl-finished-h" label="Finished">
          <FinishedRows rows={finished} onOpenChat={onOpenChat} onClear={clear} />
        </Section>
      )}
    </div>
  );
}
