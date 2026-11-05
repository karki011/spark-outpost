import {
  agentTerminalLive,
  agentTerminalName,
  agentTerminalStateText,
  type AgentTerminal,
} from '@spark-outpost/contracts';
import { providerName } from '../../chat/provider-name.ts';
import { commandTabLabel } from './command-tabs.ts';

export type AgentTabBody =
  'finding' | 'missing' | 'screen' | 'blocked' | 'loading' | 'empty' | 'saved';

export const AGENT_TAB_MISSING = 'Spark has no record of this terminal.';
export const AGENT_TAB_RUNNING =
  'Spark runs this command for the agent. Closing the tab does not stop it.';

export interface AgentTabFacts {
  terminal: AgentTerminal | null;
  searching: boolean;
  attached: boolean;
  notice: string | null;
  saved: string | null;
}

export function agentTabBody(facts: AgentTabFacts): AgentTabBody {
  const { terminal } = facts;
  if (!terminal) return facts.searching ? 'finding' : 'missing';
  if (facts.attached) return 'screen';
  if (agentTerminalLive(terminal.state)) return facts.notice ? 'blocked' : 'screen';
  if (facts.saved === null) return 'loading';
  return facts.saved === '' ? 'empty' : 'saved';
}

export function agentTabStatus(
  terminal: AgentTerminal | null,
  searching: boolean,
): 'starting' | 'open' | 'ended' {
  if (!terminal) return searching ? 'starting' : 'ended';
  return agentTerminalLive(terminal.state) ? 'open' : 'ended';
}

export function agentTabLabel(terminal: AgentTerminal): string {
  const name = agentTerminalName(terminal.name || terminal.command);
  return commandTabLabel(providerName(terminal.provider), name);
}

export function agentTabBlocked(notice: string): string {
  return `The output can’t be shown in this tab: ${notice} The command is still running.`;
}

export function agentTabFoot(terminal: AgentTerminal): string {
  if (agentTerminalLive(terminal.state)) return AGENT_TAB_RUNNING;
  return `How it ended: ${agentTerminalStateText(terminal)}.`;
}

export function runningTerminalIds(terminals: readonly AgentTerminal[] | undefined): string[] {
  return (terminals ?? [])
    .filter((terminal) => agentTerminalLive(terminal.state))
    .map((terminal) => terminal.id);
}
