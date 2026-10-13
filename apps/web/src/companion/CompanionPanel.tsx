import './companion-panel.css';
import type { KeyboardEvent, Ref } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { CheckIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import type { RunItem } from '../home/home-model.ts';
import { terminalFacts, type LinePart } from '../sessions/session-line.ts';
import { useSessionLine } from '../sessions/use-session-line.ts';
import { CORNERS, statusText, type CompanionFeed, type Corner } from './companion-model.ts';

const SECTION_LIMIT = 4;
const TERMINAL_PARTS: readonly LinePart[] = ['step', 'steps', 'subagents'];

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const CORNER_NAMES: Record<Corner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

const CORNER_DOTS: Record<Corner, [number, number]> = {
  'top-left': [7, 7],
  'top-right': [17, 7],
  'bottom-left': [7, 17],
  'bottom-right': [17, 17],
};

function CornerIcon({ corner }: { corner: Corner }) {
  const [cx, cy] = CORNER_DOTS[corner];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" />
      <circle cx={cx} cy={cy} r="3.2" fill="currentColor" />
    </svg>
  );
}

function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
  const panel = event.currentTarget;
  wrapTabFocus(event, () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]);
}

interface PanelItem {
  chat: ConversationSummary;
  provider: string | null;
  expression: BlobExpression;
  sub: string;
  action: string;
}

interface SectionSpec {
  key: string;
  title: string;
  tone: string;
  counted: boolean;
  items: PanelItem[];
}

const fromRun = (item: RunItem): PanelItem => ({
  chat: item.chat,
  provider: item.provider,
  expression: 'thinking',
  sub: item.step,
  action: 'Watch',
});

function panelSections(feed: CompanionFeed): SectionSpec[] {
  const sections: SectionSpec[] = [
    { key: 'needs', title: 'Needs you', tone: 'asking', counted: true, items: feed.needs },
    { key: 'failed', title: 'Failed', tone: 'error', counted: true, items: feed.errors },
    {
      key: 'running',
      title: 'Running',
      tone: 'running',
      counted: true,
      items: feed.running.map(fromRun),
    },
    {
      key: 'finished',
      title: 'Just finished',
      tone: 'done',
      counted: false,
      items: feed.finished,
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

interface RowProps {
  item: PanelItem;
  tone: string;
  onOpen: (chat: ConversationSummary) => void;
}

function Row({ item, tone, onOpen }: RowProps) {
  const { chat, provider, expression, sub, action } = item;
  const terminalText = terminalFacts(chat, useSessionLine(chat), TERMINAL_PARTS);
  const detail = terminalText ? `${sub} · ${terminalText}` : sub;
  return (
    <li className={`cmp-row ${tone}`}>
      <span className="cmp-ava" aria-hidden="true">
        {provider ? (
          <AgentBlob provider={provider} size={22} expression={expression} />
        ) : (
          <span className="provider-dot" />
        )}
      </span>
      <span className="cmp-txt">
        <b>{chat.title}</b>
        <small>{detail}</small>
      </span>
      <button
        type="button"
        className="cmp-go"
        aria-label={`${action}: ${chat.title}`}
        onClick={() => onOpen(chat)}
      >
        {action}
      </button>
    </li>
  );
}

interface SectionProps {
  id: string;
  section: SectionSpec;
  onOpen: (chat: ConversationSummary) => void;
  onMore: () => void;
}

function Section({ id, section, onOpen, onMore }: SectionProps) {
  const { title, tone, counted, items } = section;
  const more = items.length - SECTION_LIMIT;
  return (
    <section className="cmp-sec" aria-labelledby={id}>
      <h3 id={id}>
        {title}
        {counted && <span className="cmp-n"> · {items.length}</span>}
      </h3>
      <ul className="cmp-list">
        {items.slice(0, SECTION_LIMIT).map((item) => (
          <Row key={item.chat.id} item={item} tone={tone} onOpen={onOpen} />
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          className="cmp-more"
          aria-label={`${more} more in ${title} on Home`}
          onClick={onMore}
        >
          +{more} more
        </button>
      )}
    </section>
  );
}

interface CompanionPanelProps {
  ref: Ref<HTMLDivElement>;
  id: string;
  feed: CompanionFeed;
  corner: Corner;
  onOpenChat: (chat: ConversationSummary) => void;
  onCorner: (corner: Corner) => void;
  onHome: () => void;
  onHide: () => void;
}

export function CompanionPanel(props: CompanionPanelProps) {
  const { ref, id, feed, corner, onOpenChat, onCorner, onHome, onHide } = props;
  const sections = panelSections(feed);
  return (
    <div
      ref={ref}
      id={id}
      className="cmp-panel"
      role="dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={trapFocus}
    >
      <div className="cmp-head">
        <h2 id={`${id}-title`}>Status</h2>
        <p>{sections.length === 0 ? 'All quiet' : statusText(feed)}</p>
      </div>
      {sections.length === 0 && (
        <p className="cmp-quiet">
          <CheckIcon />
          Nothing needs you and no agents are running.
        </p>
      )}
      {sections.map((section) => (
        <Section
          key={section.key}
          id={`${id}-${section.key}`}
          section={section}
          onOpen={onOpenChat}
          onMore={onHome}
        />
      ))}
      <div className="cmp-foot">
        <button type="button" className="cmp-home" onClick={onHome}>
          Open Home
        </button>
        <div className="cmp-corner">
          <span aria-hidden="true">Position</span>
          <Segmented
            ariaLabel="Companion position"
            options={CORNERS.map((entry) => ({
              id: entry,
              label: (
                <>
                  <CornerIcon corner={entry} />
                  <span className="sr-only">{CORNER_NAMES[entry]}</span>
                </>
              ),
            }))}
            value={corner}
            onChange={(next) => onCorner(next as Corner)}
          />
        </div>
        <button type="button" className="cmp-hide" onClick={onHide}>
          Hide companion
        </button>
      </div>
    </div>
  );
}
