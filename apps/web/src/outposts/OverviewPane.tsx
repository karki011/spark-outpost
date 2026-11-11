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
  outpostId: string;
  tab: OverviewTab;
  cards: readonly ThreadCard[];
  pulls: readonly OutpostPull[];
  members: readonly MemberView[];
  stories: readonly OutpostStory[];
  selectedId: string | null;
  sections?: boolean;
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

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="op-overview-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function OverviewPane({
  outpostId,
  tab,
  cards,
  pulls,
  members,
  stories,
  selectedId,
  sections = false,
  onTab,
  onOpenThread,
  onOpenChat,
  onFill,
}: OverviewPaneProps) {
  const threads = (
    <>
      <StoryBar stories={stories} onOpenChat={onOpenChat} onFill={onFill} />
      <ThreadsTab cards={cards} selectedId={selectedId} onOpenThread={onOpenThread} />
    </>
  );
  const library = <LibraryTab outpostId={outpostId} members={members} onOpenChat={onOpenChat} />;
  const pullRequests = <PullsTab pulls={pulls} />;

  if (sections) {
    return (
      <aside className="op-pane op-overview" aria-label="Overview">
        <div className="op-pane-scroll">
          <Section id="op-overview-threads" title="Threads">
            {threads}
          </Section>
          <Section id="op-overview-library" title="Library">
            {library}
          </Section>
          <Section id="op-overview-pulls" title="Pull requests">
            {pullRequests}
          </Section>
        </div>
      </aside>
    );
  }

  let body: ReactNode;
  if (tab === 'threads') body = threads;
  else if (tab === 'library') body = library;
  else body = pullRequests;

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
