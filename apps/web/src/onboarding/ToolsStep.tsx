import { useCallback, useState, type ReactNode } from 'react';
import type { ConnectorId } from '../brand/ConnectorBlob.tsx';
import { takeCalendarCardRequest, useCalendarCardRequests } from '../calendar/calendar-open.ts';
import { CalendarCard } from '../calendar/CalendarCard.tsx';
import { CALENDAR_PATH } from '../ui/icons.tsx';
import { GitHubCard } from '../ship/GitHubCard.tsx';
import { SLACK_DESCRIPTION, SlackCard } from '../slack/SlackCard.tsx';
import { ATLASSIAN_DESCRIPTION, AtlassianCard } from '../tickets/AtlassianCard.tsx';
import { TicketSourceCard } from '../tickets/TicketSourceCard.tsx';
import { GitCheck } from './GitCheck.tsx';

export interface Connector {
  id: ConnectorId;
  name: string;
  description: string;
  icon: ReactNode;
}

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const connectors: Connector[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Open pull requests, read diffs, and check CI.',
    icon: (
      <ToolIcon>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="7" r="2" />
        <path d="M6 7v10M18 9c0 5-7 3-7 8" />
      </ToolIcon>
    ),
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: ATLASSIAN_DESCRIPTION,
    icon: (
      <ToolIcon>
        <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
        <path d="M10 9v6" />
      </ToolIcon>
    ),
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Pull issues into chats, search your workspace, and move them along as you ship.',
    icon: (
      <ToolIcon>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </ToolIcon>
    ),
  },
  {
    id: 'slack',
    name: 'Slack',
    description: SLACK_DESCRIPTION,
    icon: (
      <ToolIcon>
        <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
      </ToolIcon>
    ),
  },
];

const CALENDAR_ICON = (
  <ToolIcon>
    <path d={CALENDAR_PATH} />
  </ToolIcon>
);

export function ConnectorGrid() {
  const [openId, setOpenId] = useState<string | null>(() =>
    takeCalendarCardRequest() ? 'calendar' : null,
  );
  useCalendarCardRequests(useCallback(() => setOpenId('calendar'), []));
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  return (
    <ul className="cgrid">
      {connectors.map((connector) => {
        if (connector.id === 'github') {
          return (
            <GitHubCard
              key={connector.id}
              icon={connector.icon}
              open={openId === connector.id}
              onToggle={() => toggle(connector.id)}
            />
          );
        }
        if (connector.id === 'atlassian') {
          return (
            <AtlassianCard
              key={connector.id}
              icon={connector.icon}
              open={openId === connector.id}
              onToggle={() => toggle(connector.id)}
            />
          );
        }
        if (connector.id === 'linear') {
          return (
            <TicketSourceCard
              key={connector.id}
              source={connector.id}
              icon={connector.icon}
              description={connector.description}
              open={openId === connector.id}
              onToggle={() => toggle(connector.id)}
            />
          );
        }
        return (
          <SlackCard
            key={connector.id}
            icon={connector.icon}
            open={openId === connector.id}
            onToggle={() => toggle(connector.id)}
          />
        );
      })}
      <CalendarCard
        icon={CALENDAR_ICON}
        open={openId === 'calendar'}
        onToggle={() => toggle('calendar')}
      />
    </ul>
  );
}

export function ToolsStep() {
  return (
    <>
      <h2 id="onbTitle">Bring in your tools</h2>
      <p className="lede">
        Spark checks for Git first, since every Do chat works in its own git worktree. GitHub lets
        Ship open pull requests. Atlassian and Linear bring your tickets into Spark. Slack notifies
        you and shares threads.
      </p>
      <GitCheck />
      <ConnectorGrid />
    </>
  );
}
