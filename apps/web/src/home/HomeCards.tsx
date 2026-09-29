import type { CSSProperties, ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { activeLabel } from '../conversations/recency.ts';
import { FolderIcon } from '../ui/icons.tsx';
import type { RunItem } from './home-model.ts';

type ProjectName = (chat: ConversationSummary) => string;
type OpenChat = (chat: ConversationSummary) => void;

const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

interface HomeSectionProps {
  id: string;
  title: string;
  count?: number;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function HomeSection(props: HomeSectionProps) {
  const { id, title, count, action, className = '', children } = props;
  return (
    <section className={`hsec ${className}`.trim()} aria-labelledby={id}>
      <div className="hsec-h">
        <h2 id={id}>
          {title}
          {count !== undefined && (
            <>
              {' '}
              <span className="n">{count}</span>
            </>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children, index }: { children: ReactNode; index: number }) {
  return (
    <p className="hquiet" style={stagger(index)}>
      {children}
    </p>
  );
}

function Progress({ percent }: { percent: number | null }) {
  if (percent === null) {
    return (
      <span className="hprog wait" role="progressbar" aria-label="Progress, no plan yet">
        <i />
      </span>
    );
  }
  return (
    <span
      className="hprog"
      role="progressbar"
      aria-label="Plan progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={{ transform: `scaleX(${percent / 100})` }} />
    </span>
  );
}

interface RunningNowProps {
  items: readonly RunItem[];
  offset: number;
  projectName: ProjectName;
  onOpen: OpenChat;
}

interface RunCardProps {
  item: RunItem;
  project: string;
  index: number;
  onOpen: OpenChat;
}

function RunCard({ item, project, index, onOpen }: RunCardProps) {
  const { chat, provider } = item;
  return (
    <li className="hcard running" style={stagger(index)}>
      <span className="hblob" aria-hidden="true">
        {provider ? (
          <AgentBlob provider={provider} size={34} expression="thinking" />
        ) : (
          <span className="provider-dot" />
        )}
        <i className="hdot running" />
      </span>
      <span className="hc-main">
        <b>{chat.title}</b>
        <small>
          <span className="pj">{project}</span>
          {item.step}
        </small>
        <Progress percent={item.percent} />
      </span>
      <button
        type="button"
        className="go"
        aria-label={`Watch: ${chat.title}`}
        onClick={() => onOpen(chat)}
      >
        Watch
      </button>
    </li>
  );
}

export function RunningNow({ items, offset, projectName, onOpen }: RunningNowProps) {
  if (items.length === 0) return null;
  return (
    <HomeSection id="home-running" title="Running now" count={items.length}>
      <ul className="hlist">
        {items.map((item, index) => (
          <RunCard
            key={item.chat.id}
            item={item}
            project={projectName(item.chat)}
            index={offset + index}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </HomeSection>
  );
}

interface RecentChatsProps {
  chats: readonly ConversationSummary[];
  offset: number;
  now: number;
  onOpen: OpenChat;
  onViewAll: () => void;
}

function RecentIcon({ chat }: { chat: ConversationSummary }) {
  const provider = chat.latestRun?.provider;
  if (!provider) return <FolderIcon />;
  return (
    <span className="mblob" aria-hidden="true">
      <AgentBlob provider={provider} size={18} />
    </span>
  );
}

export function RecentChats({ chats, offset, now, onOpen, onViewAll }: RecentChatsProps) {
  return (
    <HomeSection
      id="home-recent"
      title="Recent chats"
      action={
        <button type="button" className="hlink" onClick={onViewAll}>
          View all
        </button>
      }
    >
      {chats.length === 0 ? (
        <Quiet index={offset}>No other chats yet.</Quiet>
      ) : (
        <ul className="mlist">
          {chats.map((chat, index) => (
            <li key={chat.id} style={stagger(offset + index)}>
              <button
                type="button"
                className="mrow"
                title={chat.title}
                onClick={() => onOpen(chat)}
              >
                <RecentIcon chat={chat} />
                <span className="t">{chat.title}</span>
                <span className="k">{activeLabel(chat.updatedAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

const SKELETON_WIDTHS = [66, 50, 58, 72, 44];

export function RecentSkeleton() {
  return (
    <section className="hsec" aria-hidden="true">
      <div className="hsec-h">
        <span className="hsk" style={{ width: 110, height: 14 }} />
      </div>
      <ul className="mlist">
        {SKELETON_WIDTHS.map((width) => (
          <li key={width} className="mrow">
            <span className="hsk dot sm" />
            <span className="hsk" style={{ width: `${width}%` }} />
          </li>
        ))}
      </ul>
    </section>
  );
}
