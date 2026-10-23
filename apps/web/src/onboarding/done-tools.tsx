import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ATLASSIAN_NAME, SERVICENOW_NAME, ticketSourceNames } from '@spark-outpost/contracts';
import { ConnectorBlob, type ConnectorId } from '../brand/ConnectorBlob.tsx';
import { BranchIcon } from '../ui/icons.tsx';
import { activeLine } from '../ship/GitHubCard.tsx';
import { githubApi, shipKeys } from '../ship/ship-api.ts';
import { atlassianLine } from '../tickets/AtlassianCard.tsx';
import { serviceNowLine } from '../tickets/ServiceNowCard.tsx';
import { whereLine } from '../tickets/TicketSourceCard.tsx';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { gitLabel, gitStatusQuery } from './git-status.ts';

export interface SummaryItem {
  key: string;
  icon: ReactNode;
  title: ReactNode;
  detail: string;
}

function toolItem(id: ConnectorId, name: string, detail: string): SummaryItem {
  return {
    key: id,
    icon: <ConnectorBlob connectorId={id} size={30} expression="happy" animate="always" />,
    title: <b>{name}</b>,
    detail,
  };
}

const NO_TOOLS: SummaryItem = {
  key: 'tools',
  icon: <span className="tools-dot" aria-hidden="true" />,
  title: <b>Connect tools anytime in Settings</b>,
  detail: 'GitHub, Atlassian, Linear and ServiceNow',
};

export function useToolItems(): SummaryItem[] {
  const github = useQuery({ queryKey: shipKeys.github, queryFn: githubApi.connection });
  const tickets = useQuery({ queryKey: ticketKeys.connections, queryFn: ticketsApi.connections });
  if (github.isPending || tickets.isPending) return [];
  const items: SummaryItem[] = [];
  if (github.data?.active) items.push(toolItem('github', 'GitHub', activeLine(github.data)));
  for (const connection of tickets.data?.connections ?? []) {
    if (!connection.keySaved) continue;
    if (connection.source === 'jira') {
      items.push(toolItem('atlassian', ATLASSIAN_NAME, atlassianLine(connection)));
      continue;
    }
    if (connection.source === 'servicenow') {
      items.push(toolItem('servicenow', SERVICENOW_NAME, serviceNowLine(connection)));
      continue;
    }
    const name = ticketSourceNames[connection.source];
    items.push(toolItem(connection.source, name, whereLine(connection)));
  }
  return items.length > 0 ? items : [NO_TOOLS];
}

export function useGitItem(): SummaryItem | null {
  const git = useQuery(gitStatusQuery);
  if (!git.data) return null;
  const installed = git.data.installed;
  return {
    key: 'git',
    icon: (
      <span className="git-dot" data-found={installed} aria-hidden="true">
        <BranchIcon />
      </span>
    ),
    title: <b>{gitLabel(git.data)}</b>,
    detail: installed ? 'Each Do chat gets its own worktree' : 'Needed for Do chats',
  };
}
