import { useState, type RefObject } from 'react';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import type { ConversationDetail, ConversationSummary, Project } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import type { IslandGeometry, IslandSize } from '../desktop/desktop-bridge.ts';
import type { Voice } from '../spark/voice.ts';
import type { FastState } from './ask-fast-path.ts';
import { AskSpark } from './AskSpark.tsx';
import { CardView } from './CardView.tsx';
import type { Decided } from './use-decide.ts';
import type { Card, IslandView, Panel, PeekRow as PeekRowData } from './island-model.ts';
import type { RestLine } from './island-rest-line.ts';
import { IslandInbox, type InboxBundle } from './IslandInbox.tsx';
import { NowBar } from './NowBar.tsx';
import { IslandBar, PANEL_ORDER, type BarActions, type BarCounts } from './PanelTabs.tsx';
import { QuickChat, type Compose, type FollowUp, type QuickDraft } from './QuickChat.tsx';
import { SparkTiles, type SparkTileActions } from './SparkTiles.tsx';
import type { Grab } from './use-island-drop.ts';
import { chatAgent } from './use-island-data.ts';
import type { AskSession } from './use-ask-session.ts';
import { SpeechScreen } from '../voice/SpeechScreen.tsx';
import type { SpeechScreenModel } from '../voice/use-speech-island.ts';

interface DropProps {
  grab: Grab;
  note: string | null;
  replyingTo: string | null;
  sceneRef: RefObject<HTMLDivElement | null>;
}

export interface IslandShellProps {
  compose: Compose;
  drop: DropProps;
  view: IslandView;
  geometry: IslandGeometry;
  size: IslandSize;
  mood: ScoutMood;
  reduced: boolean;
  wave: boolean;
  hover: boolean;
  greeting: string | null;
  waiting: number;
  asking: number;
  setAside: number;
  line: RestLine | null;
  calendar: IslandCalendar;
  calendarLine: CalendarLine | null;
  voice: Voice;
  speech: SpeechScreenModel | null;
  now: number;
  note: Decided | null;
  detailFor: (chatId: string) => ConversationDetail | undefined;
  focusSignal: number;
  inbox: InboxBundle;
  sparks: SparkTileActions;
  nowChat: ConversationSummary | null;
  bar: BarActions;
  counts: BarCounts;
  peek: PeekRowData;
  sleepy: boolean;
  projects: readonly Project[];
  draftId: string;
  draft: QuickDraft;
  followUp: FollowUp | null;
  fast: FastState;
  askSession: AskSession;
  announcement: string;
  onDraft: (draft: QuickDraft) => void;
  onTab: (panel: Panel) => void;
  onOpenChat: (id: string, runId?: string) => void;
  onDecided: (decided: Decided) => void;
  onLater: () => void;
  onReview: (card: Card) => void;
  onReviewChat: (chatId: string) => void;
  onLine: (line: RestLine) => void;
  onScout: () => void;
  onPeekOpen: (id: string) => void;
  onSent: (id: string, title: string, project: string | null) => void;
}

type Direction = 'next' | 'prev' | 'none';

function PanelPane({ panel, props }: { panel: Panel; props: IslandShellProps }) {
  const focusDelay = props.reduced ? 0 : 240;
  switch (panel) {
    case 'home':
      return (
        <IslandInbox
          inbox={props.inbox}
          calendar={props.calendar}
          now={props.now}
          onOpenChat={props.onOpenChat}
        />
      );
    case 'quick':
      return (
        <QuickChat
          draftId={props.draftId}
          draft={props.draft}
          followUp={props.followUp}
          projects={props.projects}
          compose={props.compose}
          focusDelay={focusDelay}
          onDraft={props.onDraft}
          onSent={props.onSent}
          footer={<SparkTiles {...props.sparks} />}
        />
      );
    case 'ask':
      return (
        <AskSpark
          fast={props.fast}
          voice={props.voice}
          focusDelay={focusDelay}
          session={props.askSession}
          meetings={props.calendar.connected ? props.calendar.upcoming : null}
          links={{
            reviewable: new Set(
              [...props.inbox.cards, ...props.inbox.aside].map((card) => card.chat.id),
            ),
            onReview: props.onReviewChat,
            onOpenChat: props.onOpenChat,
          }}
        />
      );
  }
}

function PanelBody({ panel, props }: { panel: Panel; props: IslandShellProps }) {
  const [shown, setShown] = useState<{ panel: Panel; direction: Direction }>({
    panel,
    direction: 'none',
  });
  if (shown.panel !== panel) {
    const forward = PANEL_ORDER.indexOf(panel) > PANEL_ORDER.indexOf(shown.panel);
    setShown({ panel, direction: forward ? 'next' : 'prev' });
  }
  return (
    <div className="isl-body">
      <IslandBar panel={panel} counts={props.counts} actions={props.bar} onTab={props.onTab} />
      <div key={panel} className="isl-pane" data-dir={shown.direction}>
        {props.speech && !props.speech.keepsPanel ? (
          <div className="isl-panel">
            <SpeechScreen screen={props.speech} />
          </div>
        ) : (
          <>
            {props.speech && <SpeechScreen screen={props.speech} />}
            <PanelPane panel={panel} props={props} />
          </>
        )}
      </div>
    </div>
  );
}

export function ViewBody({ props }: { props: IslandShellProps }) {
  const { view } = props;
  switch (view.kind) {
    case 'note':
      return (
        <div className="isl-body">
          <div className="isl-card isl-note" data-wash="accent" role="status">
            <div className="isl-ttl">{props.note?.title}</div>
            <div className="isl-hint">{props.note?.sub}</div>
          </div>
        </div>
      );
    case 'panel':
      return <PanelBody panel={view.panel} props={props} />;
    case 'card':
      return (
        <div className="isl-body">
          <CardView
            card={view.card}
            index={view.index}
            total={view.total}
            agent={chatAgent(view.card.chat, props.detailFor(view.card.chat.id))}
            focusSignal={props.focusSignal}
            onDecided={props.onDecided}
            onOpenChat={props.onOpenChat}
            onLater={props.onLater}
          />
        </div>
      );
    case 'now':
      return (
        <div className="isl-body">
          <NowBar chat={props.nowChat} card={view.card} onReview={props.onReview} />
        </div>
      );
    default:
      return null;
  }
}
