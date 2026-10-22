import './island-focus.css';
import './island-meeting.css';
import './island-strip.css';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Approval, ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { homeApi, homeKeys } from '../home/home-api.ts';
import { AskCard } from './AskCard.tsx';
import { FocusCard } from './FocusCard.tsx';
import { homeFocus, pageOf, soonMeeting } from './home-model.ts';
import { runningRows } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { attentionLine } from '../conversations/row-state.ts';
import { MeetingFocus, MeetingStrip, TodayMeetings } from './MeetingFocus.tsx';
import { chatAgent } from './use-island-data.ts';
import type { Decided } from './use-decide.ts';
import { WorkingTiles } from './WorkingTiles.tsx';

export interface HomeBundle {
  chats: readonly ConversationSummary[];
  cards: readonly Card[];
  aside: readonly Card[];
  seen: ReadonlySet<Card>;
  details: ReadonlyMap<string, ConversationDetail>;
  projectNames: ReadonlyMap<string, string>;
  ask: { conversationId: string | null; cards: readonly Approval[] };
  onLater: (card: Card) => void;
  onReview: (card: Card) => void;
  onDecided: (card: Card, decided: Decided) => void;
  onConnectors: (() => void) | null;
}

interface IslandHomeProps {
  home: HomeBundle;
  calendar: IslandCalendar;
  now: number;
  onOpenChat: (id: string) => void;
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

function projectOf(chat: ConversationSummary, names: ReadonlyMap<string, string>): string | null {
  const id = chat.projectIds[0];
  return id ? (names.get(id) ?? null) : null;
}

function NextRequest({ card, onShow }: { card: Card; onShow: () => void }) {
  return (
    <p className="isl-next" role="status">
      <span className="isl-next-dot" aria-hidden="true" />
      <span className="isl-next-text">
        Next: <b>{card.chat.title}</b> {attentionLine(card.chat.attention)}
      </span>
      <button type="button" className="isl-btn" onClick={onShow}>
        Show ›
      </button>
    </p>
  );
}

function AllClear({ calendar }: { calendar: IslandCalendar }) {
  return (
    <section className="isl-clear" aria-label="Nothing needs you">
      <BlobScout mood="happy" size={72} />
      <div className="isl-clear-text">
        <b>Nothing needs you</b>
        {calendar.connected && calendar.upcoming.length > 0 && (
          <span>
            {calendar.upcoming.length === 1
              ? '1 meeting left today'
              : `${calendar.upcoming.length} meetings left today`}
          </span>
        )}
      </div>
      {calendar.connected && <TodayMeetings calendar={calendar} />}
    </section>
  );
}

function AsideList({
  cards,
  onOpenChat,
}: {
  cards: readonly Card[];
  onOpenChat: (id: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="isl-aside-list" aria-labelledby="isl-aside-h">
      <h3 id="isl-aside-h">
        Set aside <span aria-hidden="true">· {cards.length}</span>
      </h3>
      <ul>
        {cards.map((card) => (
          <li key={card.approval?.id ?? card.chat.id}>
            <button
              type="button"
              className="isl-aside-row"
              onClick={() => onOpenChat(card.chat.id)}
            >
              <b>{card.chat.title}</b>
              <span>{attentionLine(card.chat.attention)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function IslandHome({ home, calendar, now, onOpenChat }: IslandHomeProps) {
  const [page, setPage] = useState(0);
  const [showFor, setShowFor] = useState<string | null>(null);
  const cards = home.cards;
  const upcoming = calendar.connected ? calendar.upcoming : [];
  const running = useMemo(() => runningRows(home.chats, home.details), [home.chats, home.details]);
  const focus = homeFocus(cards, upcoming, calendar.choosing, calendar.at);
  const meetingKey = focus.kind === 'meeting' ? focus.events.map((e) => e.key).join(' ') : null;
  const showRequest = focus.kind === 'meeting' && showFor === meetingKey && cards.length > 0;
  const index = pageOf(page, cards.length);
  const card = cards[index];
  const strip = soonMeeting(upcoming, calendar.at);
  const askId = home.ask.conversationId;
  const askCards = askId ? home.ask.cards : [];
  const requestShown = (focus.kind === 'request' || showRequest) && card;
  return (
    <div className="isl-home">
      <GitHubNote onConnectors={home.onConnectors} />
      {focus.kind === 'meeting' && !showRequest && (
        <>
          <MeetingFocus events={focus.events} calendar={calendar} />
          {card && <NextRequest card={card} onShow={() => setShowFor(meetingKey)} />}
        </>
      )}
      {requestShown && (
        <>
          <FocusCard
            key={card.approval?.id ?? card.chat.id}
            card={card}
            agent={chatAgent(card.chat, home.details.get(card.chat.id)).name}
            project={projectOf(card.chat, home.projectNames)}
            seen={home.seen.has(card)}
            index={index}
            total={cards.length}
            onPage={(next) => setPage(pageOf(next, cards.length))}
            onDecided={(decided) => home.onDecided(card, decided)}
            onLater={home.onLater}
            onReview={home.onReview}
            onOpenChat={onOpenChat}
          />
          {strip && focus.kind === 'request' && <MeetingStrip event={strip} calendar={calendar} />}
        </>
      )}
      {focus.kind === 'clear' && askCards.length === 0 && <AllClear calendar={calendar} />}
      {askCards.length > 0 && (
        <section className="isl-askcards" aria-label="Ask Spark needs you">
          {askCards.map((approval) => (
            <div key={approval.id} className="isl-inbox-ask">
              <span className="isl-inbox-ask-from">Ask Spark</span>
              <AskCard
                approval={approval}
                conversationId={askId!}
                onOpen={() => onOpenChat(askId!)}
              />
            </div>
          ))}
        </section>
      )}
      <AsideList cards={home.aside} onOpenChat={onOpenChat} />
      <WorkingTiles rows={running} now={now} onOpenChat={onOpenChat} />
    </div>
  );
}
