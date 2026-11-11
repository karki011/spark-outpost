import { useState, useSyncExternalStore } from 'react';
import { createAgentBoard, type AgentBoard } from './agent-board.ts';

interface OpensWork {
  setView(view: 'work'): void;
}

export interface ChatAgents {
  board: AgentBoard;
  has: boolean;
  open(panel: OpensWork, runId: string, workerId?: string): void;
}

export function useChatAgents(): ChatAgents {
  const [board] = useState(createAgentBoard);
  const shown = useSyncExternalStore(board.subscribe, board.shown);
  return {
    board,
    has: (shown?.rows.length ?? 0) > 0,
    open(panel, runId, workerId) {
      panel.setView('work');
      board.open(runId, workerId);
    },
  };
}
