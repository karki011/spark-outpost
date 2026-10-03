import { useState, type RefObject } from 'react';
import type { ConversationDetail, ConversationSummary, Project } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import type { IslandGeometry } from '../desktop/desktop-bridge.ts';
import type { Voice } from '../spark/voice.ts';
import type { FastState } from './ask-fast-path.ts';
import { AskSpark } from './AskSpark.tsx';
import { CardView, type Decided } from './CardView.tsx';
import type { Card, IslandView, Panel, PeekRow as PeekRowData } from './island-model.ts';
import { IslandHome, type HomeBundle } from './IslandHome.tsx';
import { IslandBar, PANEL_ORDER, type BarActions } from './PanelTabs.tsx';
import { QuickChat, type Compose, type QuickDraft } from './QuickChat.tsx';
import { Sessions } from './Sessions.tsx';
import type { GrabItem, GrabPhase } from './use-island-drop.ts';
import { chatAgent } from './use-island-data.ts';

interface DropProps {
  phase: GrabPhase;
  item: GrabItem | null;
  note: string | null;
  sceneRef: RefObject<HTMLDivElement | null>;
}

export interface IslandShellProps {
  compose: Compose;
  drop: DropProps;
  view: IslandView;
  geometry: IslandGeometry;
  mood: ScoutMood;
  reduced: boolean;
  wave: boolean;
  hover: boolean;
  greeting: string | null;
  waiting: number;
  voice: Voice;
  now: number;
  note: Decided | null;
  detailFor: (chatId: string) => ConversationDetail | undefined;
  focusSignal: number;
  sessions: ConversationSummary[];
  home: HomeBundle;
  bar: BarActions;
  peek: PeekRowData;
  sleepy: boolean;
  projectNames: ReadonlyMap<string, string>;
  projects: readonly Project[];
  selected: string | null;
  draftId: string;
  draft: QuickDraft;
  followUp: ConversationSummary | null;
  fast: FastState;
  announcement: string;
  onDraft: (draft: QuickDraft) => void;
  onTab: (panel: Panel) => void;
  onSelect: (id: string | null) => void;
  onOpenChat: (id: string) => void;
  onDecided: (decided: Decided) => void;
  onLater: () => void;
  onReview: (card: Card) => void;
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
        <IslandHome
          home={props.home}
          waiting={props.waiting}
          sleepy={props.sleepy}
          reduced={props.reduced}
          onTab={props.onTab}
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
        />
      );
    case 'sessions':
      return (
        <Sessions
          chats={props.sessions}
          projectNames={props.projectNames}
          selected={props.selected}
          now={props.now}
          focusDelay={focusDelay}
          onSelect={props.onSelect}
          onOpenChat={props.onOpenChat}
        />
      );
    case 'ask':
      return (
        <AskSpark
          fast={props.fast}
          voice={props.voice}
          focusDelay={focusDelay}
          onOpenChat={props.onOpenChat}
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
      <IslandBar panel={panel} waiting={props.waiting} actions={props.bar} onTab={props.onTab} />
      <div key={panel} className="isl-pane" data-dir={shown.direction}>
        <PanelPane panel={panel} props={props} />
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
    default:
      return null;
  }
}
