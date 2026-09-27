import './home.css';
import './home-panels.css';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { DigestCard } from './DigestCard.tsx';
import { HomeComposer } from './HomeComposer.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { NeedsYou, Quiet, RecentChats, RunningNow } from './HomeCards.tsx';
import {
  firstName,
  greeting,
  needsYou,
  recentChats,
  runningNow,
  summaryParts,
} from './home-model.ts';
import { ProviderStrip } from './ProviderStrip.tsx';
import { SpendCard } from './SpendCard.tsx';

const ENTER_MS = 700;
const TICK_MS = 60_000;

interface HomeProps {
  chats: readonly ConversationSummary[];
  mood: ScoutMood;
  draftId: string;
  seeded: boolean;
  onSeeded: () => void;
  suggestedProjectId: string | null;
  onOpenChat: (chat: ConversationSummary) => void;
  onRotateDraft: (nextDraftId: string) => void;
  onOpenId: (conversationId: string) => void;
  onChats: () => void;
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

function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function Home(props: HomeProps) {
  const { chats, mood, draftId, suggestedProjectId, onOpenChat } = props;
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const projects = useProjects();
  const projectList = projects.data ?? [];
  const entering = useEntering();
  const now = useMinuteClock();

  const name = firstName(setup.data?.profile.displayName ?? '') || 'there';
  const need = needsYou(chats);
  const running = runningNow(chats);
  const recent = recentChats(
    chats,
    [...need, ...running].map((item) => item.chat),
  );
  const seedProject =
    props.seeded || !projects.isSuccess ? null : (suggestedProjectId ?? projectList[0]?.id ?? null);
  const projectById = new Map(projectList.map((project) => [project.id, project.name]));
  const projectName = (chat: ConversationSummary) => {
    const first = chat.projectIds[0];
    return (first && projectById.get(first)) ?? 'No project';
  };

  const openById = (id: string) => {
    const chat = chats.find((entry) => entry.id === id);
    if (chat) onOpenChat(chat);
    else props.onOpenId(id);
  };

  const quiet = need.length === 0 && running.length === 0;

  return (
    <main className="page" aria-labelledby="home-greet">
      <div className="home">
        <div className="home-wrap">
          <header className="home-hero">
            <div className="hh">
              <BlobScout size={54} mood={mood} lookAtPointer />
              <h1 id="home-greet">
                {greeting(new Date().getHours())}, {name}
              </h1>
            </div>
            <div className="home-sub">
              <p className="home-summary" aria-live="polite">
                {summaryParts(chats).map((part, index) =>
                  part.strong ? <b key={index}>{part.text}</b> : part.text,
                )}
              </p>
              <ProviderStrip onSettings={props.onProviders} />
            </div>
          </header>
          <HomeComposer
            draftId={draftId}
            seedProjectId={seedProject}
            onSeeded={props.onSeeded}
            onRotate={props.onRotateDraft}
            onOpenId={props.onOpenId}
          />
          <div className={entering ? 'home-live enter' : 'home-live'}>
            {quiet ? (
              <Quiet>
                <CheckIcon />
                All quiet. Nothing needs you and no agents are running.
              </Quiet>
            ) : (
              <div className="hpair">
                <NeedsYou items={need} projectName={projectName} onOpen={onOpenChat} />
                <RunningNow
                  items={running}
                  offset={need.length}
                  projectName={projectName}
                  onOpen={onOpenChat}
                />
              </div>
            )}
            <DigestCard
              chats={chats}
              now={now}
              onOpenChat={openById}
              onContinue={(suggestion) => {
                queueDraft(suggestion.chatId, suggestion.draft);
                props.onOpenId(suggestion.chatId);
              }}
            />
            <RecentChats
              chats={recent}
              offset={need.length + running.length}
              now={now}
              onOpen={onOpenChat}
              onViewAll={props.onChats}
            />
            <div className="hsecondary">
              <SpendCard onUsage={props.onUsage} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
