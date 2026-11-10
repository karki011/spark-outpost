import './home.css';
import './home-rows.css';
import './home-panels.css';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketItemId, ticketsFlowFrom, type ConversationSummary } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { useVoice } from '../spark/use-voice.ts';
import { headline, headlineMood, type HeadlineFacts } from '../spark/voice.ts';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { useUpcoming } from '../calendar/use-upcoming.ts';
import {
  useAttentionItems,
  useAlertingChats,
  useMarkAttention,
} from '../attention/use-attention.ts';
import { BeforeLead } from './BeforeLead.tsx';
import { HomeComposer } from './HomeComposer.tsx';
import { HomeLayout } from './HomeLayout.tsx';
import { HomeHeader } from './HomeHeader.tsx';
import { LeadSkeleton } from './HomeCards.tsx';
import { MeetingLead } from './MeetingLead.tsx';
import { NeedsToday } from './NeedsToday.tsx';
import { SinceLead } from './SinceLead.tsx';
import { WorkingColumn } from './WorkingColumn.tsx';
import { DayColumn } from './DayColumn.tsx';
import { RecapCard, RecapEarly } from './recap/RecapCard.tsx';
import { useRecap } from './recap/use-recap.ts';
import { leftoverNeeds, needsColumn, reviewItems } from './board-model.ts';
import { needsYou, runningNow } from './home-model.ts';
import { pickLead } from './lead-state.ts';
import { briefEntries, feedRows, type BriefEntry } from './needs-model.ts';
import { capRows, sinceRows, type SinceRow } from './since-model.ts';
import { useAttentionSettings, useBrief } from './use-brief.ts';
import { useAwayKeys } from './use-away-keys.ts';
import { useMeetingLead } from './use-meeting-lead.ts';
import { useRunModes } from './use-run-modes.ts';

const ENTER_MS = 700;
const MINUTE_MS = 60_000;

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
  const connected = (connections.data?.connections ?? []).some(ticketsFlowFrom);
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

function minutesToStart(start: number, now: number): number {
  return start >= now
    ? Math.ceil((start - now) / MINUTE_MS)
    : -Math.floor((now - start) / MINUTE_MS);
}

export function Home(props: HomeProps) {
  const { chats, draftId, onOpenChat } = props;
  const projects = useProjects();
  const entering = useEntering();
  const now = useMinuteClock();
  const voice = useVoice();
  const attention = useAttentionItems();
  const markAttention = useMarkAttention();
  const alerting = useAlertingChats();
  const away = useAwayKeys(attention.items, attention.loaded);
  const day = useUpcoming(now);
  const meeting = useMeetingLead(day, now);

  const need = needsYou(chats);
  const asking = need.filter((item) => item.tone === 'asking');
  const running = runningNow(chats);
  const rows = sinceRows(attention.items, away.keys, chats);
  const updates = rows.filter((row) => row.kind !== 'waiting');
  const loading = props.loading || !attention.loaded || !away.ready || day.pending;
  const lead = pickLead({
    loading,
    now,
    meetingActive: meeting.event !== null,
    awayUpdates: updates.length,
    busy: asking.length + running.length,
  });
  const capabilities = useRunModes(lead === 'meeting' || lead === 'before-you-go' ? running : []);

  const inLead = new Set<string>(
    lead === 'since-you-left'
      ? capRows(rows).shown.map((row) => row.chat.id)
      : lead === 'meeting' || lead === 'before-you-go'
        ? asking.map((item) => item.chat.id)
        : [],
  );
  const leftover = leftoverNeeds(need, inLead);
  const review = reviewItems(need, attention.items, chats, inLead);

  const projectById = new Map(projects.data?.map((project) => [project.id, project.name]));
  const projectName = (chat: ConversationSummary) => {
    const first = chat.projectIds[0];
    return (first && projectById.get(first)) ?? 'No project';
  };
  const brief = useBrief({ writeOnOpen: true });
  const recap = useRecap();
  const hint = useConnectHint();
  const titleOf = useTicketTitles();
  const entries = briefEntries(brief.current, chats, titleOf);

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
  const openRow = (row: SinceRow) => {
    markAttention([row.key], 'read');
    onOpenChat(row.chat);
  };

  const meetingStart = meeting.event ? Date.parse(meeting.event.start) : now;
  const facts: HeadlineFacts = {
    kind: lead === 'loading' ? 'board' : lead,
    hour: new Date(now).getHours(),
    waiting:
      lead === 'board' ? need.filter((item) => alerting.has(item.chat.id)).length : asking.length,
    working: running.length,
    updates: updates.length,
    failed: updates.filter((row) => row.kind === 'failed').length,
    meeting: meeting.event?.title ?? null,
    minutes: minutesToStart(meetingStart, now),
  };
  const recapNode =
    recap.view === 'early' ? (
      <RecapEarly recap={recap} />
    ) : recap.view !== 'hidden' ? (
      <RecapCard recap={recap} onOpenId={props.onOpenId} />
    ) : null;

  return (
    <HomeLayout
      entering={entering}
      loading={loading}
      header={
        <HomeHeader
          text={headline(voice, facts)}
          mood={headlineMood(facts, props.mood)}
          loading={loading}
          now={now}
        />
      }
      lead={
        <>
          {lead === 'loading' && <LeadSkeleton />}
          {lead === 'since-you-left' && <SinceLead rows={rows} onOpen={openRow} />}
          {lead === 'meeting' && meeting.event && (
            <MeetingLead
              event={meeting.event}
              clashes={day.clashes.get(meeting.event.key)}
              actions={meeting}
              now={now}
              waiting={asking}
              running={running}
              capabilities={capabilities}
              onOpen={onOpenChat}
            />
          )}
          {lead === 'before-you-go' && (
            <BeforeLead
              waiting={asking}
              running={running}
              capabilities={capabilities}
              onOpen={onOpenChat}
            />
          )}
        </>
      }
      composer={
        <HomeComposer
          draftId={draftId}
          onRotate={props.onRotateDraft}
          onOpenId={props.onOpenId}
          compact={lead !== 'board'}
        />
      }
      board={
        <>
          <div className="hcol">
            <NeedsToday
              mode={needsColumn(leftover)}
              loading={props.loading}
              brief={brief}
              rows={feedRows(leftover, now)}
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
          </div>
          <WorkingColumn
            running={running}
            review={review}
            loading={props.loading}
            now={now}
            projectName={projectName}
            onOpen={onOpenChat}
            onReview={(item) => {
              if (item.attentionKey) markAttention([item.attentionKey], 'read');
              onOpenChat(item.chat);
            }}
            onOpenId={props.onOpenId}
          />
          <DayColumn
            day={day}
            lead={lead}
            leadEventKey={meeting.event?.key ?? null}
            chats={chats}
            now={now}
            recap={recapNode}
            onUsage={props.onUsage}
            onProviders={props.onProviders}
          />
        </>
      }
      foot={
        <p className="home-foot">
          <button type="button" className="hlink" onClick={props.onChats}>
            Recent chats
          </button>
        </p>
      }
    />
  );
}
