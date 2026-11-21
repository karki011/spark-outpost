import { useCallback, type ReactNode } from 'react';
import type { WorkTab } from '../tasks/TaskDetails.tsx';
import { ViewChangesContext, type ViewChanges } from '../tasks/view-changes.ts';
import { OpenPlanContext } from './plans/PlanSavedLine.tsx';
import { StatusContext } from './status/status-context.ts';
import type { StatusStore } from './status/status-store.ts';
import { AgentBoardContext, type AgentBoard } from './subagents/agent-board.ts';
import { OpenAgentsContext } from './subagents/SubagentsLine.tsx';
import { OpenSubChatsContext } from './sub-chats/StartedLine.tsx';
import { useWorkflowCardState, WorkflowCardFocusContext } from './workflow-card/card-focus.ts';

interface ChatContextsProps {
  viewChanges: ViewChanges | null;
  openTab: (tab: WorkTab) => void;
  hasTask: boolean;
  status: StatusStore;
  board: AgentBoard;
  openAgents: ((runId: string, workerId?: string) => void) | null;
  conversationId: string;
  children: ReactNode;
}

export function ChatContexts({
  viewChanges,
  openTab,
  hasTask,
  status,
  board,
  openAgents,
  conversationId,
  children,
}: ChatContextsProps) {
  const workflowCard = useWorkflowCardState(conversationId);
  const openPlan = useCallback(() => openTab('plan'), [openTab]);
  const openSubChats = useCallback(() => openTab('sub-chats'), [openTab]);
  return (
    <ViewChangesContext value={viewChanges}>
      <OpenPlanContext value={hasTask ? openPlan : null}>
        <OpenSubChatsContext value={openSubChats}>
          <StatusContext value={status}>
            <AgentBoardContext value={board}>
              <OpenAgentsContext value={openAgents}>
                <WorkflowCardFocusContext value={workflowCard}>{children}</WorkflowCardFocusContext>
              </OpenAgentsContext>
            </AgentBoardContext>
          </StatusContext>
        </OpenSubChatsContext>
      </OpenPlanContext>
    </ViewChangesContext>
  );
}
