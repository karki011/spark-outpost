import './home.css';
import './home-panels.css';
import './home-needs.css';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketItemId, type ConversationSummary } from '@spark-outpost/contracts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { useVoice } from '../spark/use-voice.ts';
import { greeting, quietSummary } from '../spark/voice.ts';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { prefersReducedMotion } from '../ui/motion.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { UpcomingCard } from '../calendar/UpcomingCard.tsx';
import { HomeComposer } from './HomeComposer.tsx';
import { RecentChats, RecentSkeleton, RunningNow } from './HomeCards.tsx';
import { needsYou, recentChats, runningNow, summaryParts } from './home-model.ts';
import { briefEntries, feedRows, needsMode, type BriefEntry } from './needs-model.ts';
import { NeedsToday } from './NeedsToday.tsx';
import { ProviderStrip } from './ProviderStrip.tsx';
import { SpendCard } from './SpendCard.tsx';
import { TeammateRoster } from '../teammates/TeammateRoster.tsx';
import { useAttentionSettings, useBrief } from './use-brief.ts';

const ENTER_MS = 700;

interface HomeProps {
  chats: readonly ConversationSummary[];
  loading: boolean;
  mood: ScoutMood;
  draftId: string;
  onOpenChat: (chat: ConversationSummary) => void;
  onRotateDraft: (nextDraftId: string) => void;
  onOpenId: (conversationId: string) => void;
  onChats: () => void;
  onTickets: (itemId: string | null) => void;
  onUsage: () => void;
  onProviders: () => void;
}

function focusFeed() {
  const first = document.querySelector<HTMLElement>('#home-needs .lr-main');
  first?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  first?.focus({ preventScroll: true });
}

function useEntering(): boolean {
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setEntering(false), ENTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return entering;
}

function useConnectHint() {
  const attention = useAttentionSettings();
  const connections = useQuery({
    queryKey: ticketKeys.connections,
    queryFn: ticketsApi.connections,
  });
  const connected = (connections.data?.connections ?? []).some((entry) => entry.keySaved);
  return {
    show:
      attention.loaded && connections.isSuccess && !connected
        ? !attention.settings.connectHintDismissed
        : false,
    dismiss: () => void attention.save({ connectHintDismissed: true }),
  };
}

function useTicketTitles() {
  const inbox = useQuery({ queryKey: ticketKeys.inbox, queryFn: ticketsApi.inbox, enabled: false });
  const titles = new Map(
    (inbox.data?.tickets ?? []).map((ticket) => [
      ticketItemId(ticket.source, ticket.key),
      ticket.title,
    ]),
  );
  return (itemId: string) => titles.get(itemId) ?? null;
}

export function Home(props: HomeProps) {
  const { chats, mood, draftId, onOpenChat } = props;
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const entering = useEntering();
  const now = useMinuteClock();

  const voice = useVoice();
  const need = needsYou(chats);
  const running = runningNow(chats);
  const recent = recentChats(
    chats,
    [...need, ...running].map((item) => item.chat),
  );
  const projectById = new Map(projectList.map((project) => [project.id, project.name]));
  const projectName = (chat: ConversationSummary) => {
    const first = chat.projectIds[0];
    return (first && projectById.get(first)) ?? 'No project';
  };
  const brief = useBrief({ writeOnOpen: true });
  const hint = useConnectHint();
  const titleOf = useTicketTitles();
  const entries = briefEntries(brief.current, chats, titleOf);
  const mode = needsMode({
    loading: props.loading,
    needCount: need.length,
    entryCount: entries.length,
    briefOn: brief.on,
  });

  const openById = (id: string) => {
    const chat = chats.find((entry) => entry.id === id);
    if (chat) onOpenChat(chat);
    else props.onOpenId(id);
  };

  const openEntry = (entry: BriefEntry) => {
    const { target } = entry;
    if (target.kind === 'ticket') return props.onTickets(target.itemId);
    if (!target.draft) return onOpenChat(target.chat);
    queueDraft(target.chat.id, target.draft);
    props.onOpenId(target.chat.id);
  };

  return (
    <main className="page" aria-labelledby="home-greet">
      <div className="home">
        <div className="home-wrap">
          <header className="home-hero">
            <div className="hh">
              <BlobScout size={54} mood={mood} lookAtPointer />
              <h1 id="home-greet">{greeting(voice, new Date().getHours())}</h1>
            </div>
            <div className="home-sub">
              <p className="home-summary" aria-live="polite">
                {props.loading ? (
                  <span className="hsk summary" aria-hidden="true" />
                ) : (
                  summaryParts(chats, need.length, quietSummary(voice)).map((part, index) =>
                    part.link ? (
                      <button
                        key={index}
                        type="button"
                        className="summary-link"
                        onClick={focusFeed}
                      >
                        <b>{part.text}</b>
                      </button>
                    ) : part.strong ? (
                      <b key={index}>{part.text}</b>
                    ) : (
                      part.text
                    ),
                  )
                )}
              </p>
              <ProviderStrip onSettings={props.onProviders} />
            </div>
          </header>
          <HomeComposer
            draftId={draftId}
            onRotate={props.onRotateDraft}
            onOpenId={props.onOpenId}
          />
          <div className={entering ? 'home-live enter' : 'home-live'} aria-busy={props.loading}>
            <NeedsToday
              mode={mode}
              brief={brief}
              rows={feedRows(need, now)}
              entries={entries}
              connectHint={hint.show}
              voice={voice}
              now={now}
              onOpen={onOpenChat}
              onOpenId={openById}
              onEntry={openEntry}
              onConnect={() => props.onTickets(null)}
              onDismissHint={hint.dismiss}
            />
            <UpcomingCard chats={chats} now={now} />
            <RunningNow
              items={running}
              offset={need.length}
              projectName={projectName}
              onOpen={onOpenChat}
            />
            <TeammateRoster now={now} onOpenId={props.onOpenId} />
            {props.loading ? (
              <RecentSkeleton />
            ) : (
              <RecentChats
                chats={recent}
                offset={need.length + running.length}
                now={now}
                onOpen={onOpenChat}
                onViewAll={props.onChats}
              />
            )}
            <div className="hsecondary">
              <SpendCard onUsage={props.onUsage} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
