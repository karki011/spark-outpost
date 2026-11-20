import { createContext, useContext, useMemo, useState } from 'react';
import { useDismissed } from '../dock/use-dismissed.ts';
import { WORKFLOW_DISMISSED } from './workflow-card-model.ts';

export interface WorkflowCardFocus {
  openTurn: string | null;
  setOpenTurn: (turnRunId: string | null) => void;
  dismissed: ReadonlySet<string>;
  dismiss: (turnRunId: string) => void;
}

export const WorkflowCardFocusContext = createContext<WorkflowCardFocus | null>(null);

export function useWorkflowCardFocus(): WorkflowCardFocus | null {
  return useContext(WorkflowCardFocusContext);
}

export function useWorkflowCardState(conversationId: string): WorkflowCardFocus {
  const [open, setOpen] = useState<{ conversationId: string; turnRunId: string | null }>({
    conversationId,
    turnRunId: null,
  });
  const [dismissed, dismiss] = useDismissed(WORKFLOW_DISMISSED, conversationId);
  const openTurn = open.conversationId === conversationId ? open.turnRunId : null;
  return useMemo(
    () => ({
      openTurn,
      setOpenTurn: (turnRunId: string | null) => setOpen({ conversationId, turnRunId }),
      dismissed,
      dismiss,
    }),
    [openTurn, conversationId, dismissed, dismiss],
  );
}
