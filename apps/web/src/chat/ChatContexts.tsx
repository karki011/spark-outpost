import type { ReactNode } from 'react';
import { ViewChangesContext, type ViewChanges } from '../tasks/view-changes.ts';
import { OpenPlanContext } from './plans/PlanSavedLine.tsx';
import { StatusContext } from './status/status-context.ts';
import type { StatusStore } from './status/status-store.ts';
import { AgentBoardContext, type AgentBoard } from './subagents/agent-board.ts';
import { OpenAgentsContext } from './subagents/SubagentsLine.tsx';

interface ChatContextsProps {
  viewChanges: ViewChanges | null;
  openPlan: (() => void) | null;
  status: StatusStore;
  board: AgentBoard;
  openAgents: ((runId: string) => void) | null;
  children: ReactNode;
}

export function ChatContexts({
  viewChanges,
  openPlan,
  status,
  board,
  openAgents,
  children,
}: ChatContextsProps) {
  return (
    <ViewChangesContext value={viewChanges}>
      <OpenPlanContext value={openPlan}>
        <StatusContext value={status}>
          <AgentBoardContext value={board}>
            <OpenAgentsContext value={openAgents}>{children}</OpenAgentsContext>
          </AgentBoardContext>
        </StatusContext>
      </OpenPlanContext>
    </ViewChangesContext>
  );
}
