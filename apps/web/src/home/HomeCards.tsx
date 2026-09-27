import type { CSSProperties, ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { activeLabel } from '../conversations/recency.ts';
import { CheckIcon, FolderIcon } from '../ui/icons.tsx';
import type { NeedItem, RunItem } from './home-model.ts';

type ProjectName = (chat: ConversationSummary) => string;
type OpenChat = (chat: ConversationSummary) => void;

const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

interface HomeSectionProps {
  id: string;
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function HomeSection({ id, title, action, className = '', children }: HomeSectionProps) {
  return (
    <section className={`hsec ${className}`.trim()} aria-labelledby={id}>
      <div className="hsec-h">
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

interface QuietProps {
  children: ReactNode;
  index?: number;
  compact?: boolean;
}

export function Quiet({ children, index = 0, compact = false }: QuietProps) {
  return (
    <p className={compact ? 'hquiet compact' : 'hquiet'} style={stagger(index)}>
      {children}
    </p>
  );
}

interface CardProps {
  chat: ConversationSummary;
  tone: string;
  provider: string | null;
  expression: BlobExpression;
  sub: string;
  action: string;
  project: string;
  index: number;
  onOpen: OpenChat;
  children?: ReactNode;
}

function HomeCard(props: CardProps) {
  const { chat, tone, provider, expression, sub, action, project, index, onOpen } = props;
  return (
    <li className={`hcard ${tone}`} style={stagger(index)}>
      <span className="hblob" aria-hidden="true">
        {provider ? (
          <AgentBlob provider={provider} size={34} expression={expression} />
        ) : (
          <span className="provider-dot" />
        )}
        <i className={`hdot ${tone}`} />
      </span>
      <span className="hc-main">
        <b>{chat.title}</b>
        <small>
          <span className="pj">{project}</span>
          <span className="hc-sub">{sub}</span>
        </small>
        {props.children}
      </span>
      <button
        type="button"
        className="go"
        aria-label={`${action}: ${chat.title}`}
        onClick={() => onOpen(chat)}
      >
        {action}
      </button>
    </li>
  );
}

interface NeedsYouProps {
  items: readonly NeedItem[];
  projectName: ProjectName;
  onOpen: OpenChat;
}

export function NeedsYou({ items, projectName, onOpen }: NeedsYouProps) {
  return (
    <HomeSection id="home-needs" title="Needs you">
      {items.length === 0 ? (
        <Quiet compact>
          <CheckIcon />
          Nothing needs you right now.
        </Quiet>
      ) : (
        <ul className="hlist">
          {items.map((item, index) => (
            <HomeCard
              key={item.chat.id}
              chat={item.chat}
              tone={item.tone}
              provider={item.provider}
              expression={item.expression}
              sub={item.sub}
              action={item.action}
              project={projectName(item.chat)}
              index={index}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </HomeSection>
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

export function RunningNow({ items, offset, projectName, onOpen }: RunningNowProps) {
  return (
    <HomeSection id="home-running" title="Running now">
      {items.length === 0 ? (
        <Quiet compact index={offset}>
          No agents running.
        </Quiet>
      ) : (
        <ul className="hlist">
          {items.map((item, index) => (
            <HomeCard
              key={item.chat.id}
              chat={item.chat}
              tone="running"
              provider={item.provider}
              expression="thinking"
              sub={item.step}
              action="Watch"
              project={projectName(item.chat)}
              index={offset + index}
              onOpen={onOpen}
            >
              <Progress percent={item.percent} />
            </HomeCard>
          ))}
        </ul>
      )}
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
