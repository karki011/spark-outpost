import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { GitHubCard } from '../ship/GitHubCard.tsx';
import { TicketSourceCard } from '../tickets/TicketSourceCard.tsx';
import { reveal } from '../ui/transitions.tsx';
import './tools.css';

export interface Connector {
  id: string;
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
    id: 'jira',
    name: 'Jira',
    description: 'Sort your tickets, search every issue you can see, and start work from one.',
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
    description: 'Read threads you share and post updates back.',
    icon: (
      <ToolIcon>
        <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
      </ToolIcon>
    ),
  },
];

export function ConnectorGrid() {
  return (
    <ul className="cgrid">
      {connectors.map((connector, index) => {
        if (connector.id === 'github') {
          return <GitHubCard key={connector.id} icon={connector.icon} />;
        }
        if (connector.id === 'jira' || connector.id === 'linear') {
          return (
            <TicketSourceCard
              key={connector.id}
              source={connector.id}
              icon={connector.icon}
              description={connector.description}
              primary={connector.id === 'jira'}
            />
          );
        }
        return (
          <motion.li
            key={connector.id}
            className="ccard"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...reveal, delay: index * 0.07 }}
            whileHover={{ y: -3 }}
          >
            <div className="top">
              <span className="plogo">{connector.icon}</span>
              <b>{connector.name}</b>
            </div>
            <p>{connector.description}</p>
            <div className="row2">
              <span className="soon">Coming soon</span>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

export function ToolsStep() {
  return (
    <>
      <h2 id="onbTitle">Bring in your tools</h2>
      <p className="lede">
        GitHub lets Ship open draft pull requests. Jira and Linear bring your tickets into Spark.
        Slack isn't ready yet.
      </p>
      <ConnectorGrid />
    </>
  );
}
