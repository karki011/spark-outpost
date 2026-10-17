import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import type { Panel } from './island-model.ts';
import { NowCard } from './NowCard.tsx';
import type { QuickStart } from './now-parts.tsx';
import { SparkTiles } from './SparkTiles.tsx';
import { IslandMeetings } from './IslandMeetings.tsx';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';

export interface HomeBundle {
  sessions: readonly ConversationSummary[];
  quickStart: QuickStart | null;
  onOpenHere: (id: string) => void;
  onNewIn: (projectId: string | null) => void;
  onMakeSpark: (() => void) | null;
  onEditSpark: ((id: string) => void) | null;
  onConnectors: (() => void) | null;
}

interface IslandHomeProps {
  home: HomeBundle;
  calendar: IslandCalendar;
  waiting: number;
  sleepy: boolean;
  reduced: boolean;
  onTab: (panel: Panel) => void;
  onOpenChat: (id: string, runId?: string) => void;
}

export function IslandHome({
  home,
  calendar,
  waiting,
  sleepy,
  reduced,
  onTab,
  onOpenChat,
}: IslandHomeProps) {
  const health = useQuery({ queryKey: homeKeys.health, queryFn: homeApi.health });
  return (
    <div className="isl-home">
      {health.data?.githubSignInNeeded && (
        <p className="isl-hnote" role="status">
          <span>GitHub sign-in ended. Runs keep going with your other logins.</span>
          {home.onConnectors && (
            <button type="button" className="isl-hnote-act" onClick={home.onConnectors}>
              Sign in again
            </button>
          )}
        </p>
      )}
      <NowCard
        sessions={home.sessions}
        reduced={reduced}
        sleepy={sleepy}
        quickStart={home.quickStart}
        onOpenHere={home.onOpenHere}
        onOpenChat={onOpenChat}
        onAsk={() => onTab('ask')}
        onNewIn={home.onNewIn}
      />
      <div className="isl-home-side">
        <IslandMeetings calendar={calendar} />
        <SparkTiles
          waiting={waiting}
          quickStart={home.quickStart}
          onOpenHere={home.onOpenHere}
          onNewIn={home.onNewIn}
          onAsk={() => onTab('ask')}
          onChats={() => onTab('sessions')}
          onMakeSpark={home.onMakeSpark}
          onEditSpark={home.onEditSpark}
        />
      </div>
    </div>
  );
}
