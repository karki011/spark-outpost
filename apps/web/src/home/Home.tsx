import './home.css';
import './home-rows.css';
import './home-panels.css';
import { useEffect, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useVoice } from '../spark/use-voice.ts';
import { headline, headlineMood, type HeadlineFacts } from '../spark/voice.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { useUpcoming } from '../calendar/use-upcoming.ts';
import { useAttentionItems, useMarkAttention } from '../attention/use-attention.ts';
import { SlackMentions } from '../slack/SlackMentions.tsx';
import { slackMentionRows } from '../slack/slack-mentions-model.ts';
import { BriefSection } from './BriefSection.tsx';
import { HomeCard } from './HomeCards.tsx';
import { HomeComposer } from './HomeComposer.tsx';
import { HomeHeader } from './HomeHeader.tsx';
import { HomeLayout } from './HomeLayout.tsx';
import { MeetingLine } from './MeetingLine.tsx';
import { NeedsFeed } from './NeedsFeed.tsx';
import { ProviderNotice } from './ProviderNotice.tsx';
import { WorkingSet } from './WorkingSet.tsx';
import { RecapCard, RecapEarly } from './recap/RecapCard.tsx';
import { useRecap } from './recap/use-recap.ts';
import { reviewItems } from './working-set-model.ts';
import { needsYou, runningNow } from './home-model.ts';
import { feedRows } from './needs-model.ts';
import { useBrief } from './use-brief.ts';
import { useMeetingLead } from './use-meeting-lead.ts';
import { HomeAnswersProvider } from './use-answer-card.tsx';

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

function minutesToStart(start: number, now: number): number {
  return start >= now
    ? Math.ceil((start - now) / MINUTE_MS)
    : -Math.floor((now - start) / MINUTE_MS);
}

export function Home(props: HomeProps) {
  const { chats, onOpenChat } = props;
  const projects = useProjects();
  const entering = useEntering();
  const now = useMinuteClock();
  const voice = useVoice();
  const attention = useAttentionItems();
  const markAttention = useMarkAttention();
  const day = useUpcoming(now);
  const meeting = useMeetingLead(day, now);
  const brief = useBrief({ writeOnOpen: true });
  const recap = useRecap();

  const need = needsYou(chats);
  const blocked = need.filter((item) => item.tone !== 'done');
  const running = runningNow(chats);
  const review = reviewItems(need, attention.items, chats);
  const mentions = slackMentionRows(attention.items);
  const loading = props.loading || !attention.loaded || day.pending;

  const projectById = new Map(projects.data?.map((project) => [project.id, project.name]));
  const projectName = (chat: ConversationSummary) => {
    const first = chat.projectIds[0];
    return (first && projectById.get(first)) ?? 'No project';
  };

  const meetingStart = meeting.event ? Date.parse(meeting.event.start) : now;
  const facts: HeadlineFacts = {
    kind: meeting.event ? 'meeting' : 'board',
    hour: new Date(now).getHours(),
    waiting: blocked.length,
    working: running.length,
    meeting: meeting.event?.title ?? null,
    minutes: minutesToStart(meetingStart, now),
  };

  return (
    <HomeAnswersProvider>
      <HomeLayout
        entering={entering}
        loading={loading}
        header={
          <HomeHeader
            text={headline(voice, facts)}
            mood={headlineMood(facts, props.mood)}
            loading={loading}
            aside={<MeetingLine day={day} meeting={meeting} now={now} />}
          />
        }
        composer={
          <HomeComposer
            draftId={props.draftId}
            onRotate={props.onRotateDraft}
            onOpenId={props.onOpenId}
          />
        }
        foot={
          <p className="home-foot">
            <button type="button" className="hlink" onClick={props.onChats}>
              All chats
            </button>
          </p>
        }
      >
        <ProviderNotice onSettings={props.onProviders} />
        {blocked.length > 0 && (
          <HomeCard id="home-needs" title="Needs you" count={blocked.length} className="home-needs">
            <NeedsFeed rows={feedRows(blocked, now)} onOpen={onOpenChat} />
          </HomeCard>
        )}
        <SlackMentions
          rows={mentions}
          now={now}
          onRead={(key) => markAttention([key], 'read')}
          onDismiss={(key) => markAttention([key], 'dismiss')}
        />
        <WorkingSet
          running={running}
          review={review}
          loading={props.loading}
          projectName={projectName}
          onOpen={onOpenChat}
          onReview={(item) => {
            if (item.attentionKey) markAttention([item.attentionKey], 'read');
            onOpenChat(item.chat);
          }}
        />
        <BriefSection
          brief={brief}
          chats={chats}
          flagged={blocked.length}
          voice={voice}
          now={now}
          onOpenChat={onOpenChat}
          onOpenId={props.onOpenId}
          onTickets={props.onTickets}
        />
        {recap.view === 'early' && <RecapEarly recap={recap} />}
        {recap.view !== 'early' && recap.view !== 'hidden' && (
          <RecapCard recap={recap} onOpenId={props.onOpenId} />
        )}
      </HomeLayout>
    </HomeAnswersProvider>
  );
}
