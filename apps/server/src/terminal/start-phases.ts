import type { TerminalStartPhase } from '@spark-outpost/contracts';

export interface StartPhases {
  get(conversationId: string): TerminalStartPhase | null;
  set(conversationId: string, phase: TerminalStartPhase): void;
  clear(conversationId: string): void;
}

export function startPhases(changed: (conversationId: string) => void): StartPhases {
  const current = new Map<string, TerminalStartPhase>();
  return {
    get: (conversationId) => current.get(conversationId) ?? null,
    set: (conversationId, phase) => {
      if (current.get(conversationId) === phase) return;
      current.set(conversationId, phase);
      changed(conversationId);
    },
    clear: (conversationId) => {
      if (current.delete(conversationId)) changed(conversationId);
    },
  };
}
