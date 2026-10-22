import './outpost-overview.css';
import type { ReactNode } from 'react';
import type { OutpostStory } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import { LibraryTab } from './LibraryTab.tsx';
import type { MemberView } from './member-view.ts';
import type { OutpostPull } from './outpost-pulls.ts';
import { PullsTab } from './PullsTab.tsx';
import { StoryBar } from './StoryBar.tsx';
import { ThreadsTab } from './ThreadsTab.tsx';
import type { ThreadCard } from './thread-cards.ts';

export type OverviewTab = 'threads' | 'library' | 'pulls';

const TAB_IDS: readonly OverviewTab[] = ['threads', 'library', 'pulls'];

interface OverviewPaneProps {
  tab: OverviewTab;
  cards: readonly ThreadCard[];
  pulls: readonly OutpostPull[];
  members: readonly MemberView[];
  stories: readonly OutpostStory[];
  selectedId: string | null;
  onTab: (tab: OverviewTab) => void;
  onOpenThread: (postId: string) => void;
  onOpenChat: (conversationId: string) => void;
  onFill: (text: string) => void;
}

function label(text: string, count: number | null) {
  return (
    <>
      {text}
      {count !== null && count > 0 && <span className="op-tab-count">{count}</span>}
    </>
  );
}

function isTab(id: string): id is OverviewTab {
  return (TAB_IDS as readonly string[]).includes(id);
}

export function OverviewPane({
  tab,
  cards,
  pulls,
  members,
  stories,
  selectedId,
  onTab,
  onOpenThread,
  onOpenChat,
  onFill,
}: OverviewPaneProps) {
  let body: ReactNode;
  if (tab === 'threads') {
    body = (
      <>
        <StoryBar stories={stories} onOpenChat={onOpenChat} onFill={onFill} />
        <ThreadsTab cards={cards} selectedId={selectedId} onOpenThread={onOpenThread} />
      </>
    );
  } else if (tab === 'library') {
    body = <LibraryTab members={members} onOpenChat={onOpenChat} />;
  } else {
    body = <PullsTab pulls={pulls} />;
  }

  return (
    <aside className="op-pane op-overview" aria-label="Overview">
      <div className="op-pane-head">
        <Segmented
          ariaLabel="Overview"
          value={tab}
          options={[
            { id: 'threads', label: label('Threads', cards.length) },
            { id: 'library', label: 'Library' },
            { id: 'pulls', label: label('Pull requests', pulls.length) },
          ]}
          onChange={(id) => {
            if (isTab(id)) onTab(id);
          }}
        />
      </div>
      <div className="op-pane-scroll">{body}</div>
    </aside>
  );
}
