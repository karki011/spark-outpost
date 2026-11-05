import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { conversationSummarySchema, isTrackedTerminalProvider } from '@spark-outpost/contracts';
import { api, forgetDraft, queryKeys, request } from '../api/client.ts';
import { nativeTerminalApi } from './terminal-api.ts';
import type { SessionChoice } from './SessionTypePicker.tsx';

export interface TerminalStartEvents {
  onStarting?: (() => void) | undefined;
  onLaunched?: (() => void) | undefined;
  onFailed?: ((created: boolean) => void) | undefined;
}

interface TerminalStartRequest {
  conversationId: string;
  choice: SessionChoice;
  projectIds: string[];
  agentMode: string | null;
  prompt: string;
}

export function useTerminalStart(events: TerminalStartEvents) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const message = useRef<{ id: string; prompt: string } | null>(null);
  const start = async ({
    conversationId,
    choice,
    projectIds,
    agentMode,
    prompt,
  }: TerminalStartRequest) => {
    if (message.current?.prompt !== prompt) message.current = { id: crypto.randomUUID(), prompt };
    const messageId = message.current.id;
    setBusy(true);
    events.onStarting?.();
    setError(null);
    let created = false;
    try {
      await request(conversationSummarySchema, '/conversations', {
        method: 'POST',
        body: JSON.stringify({ id: conversationId, ...choice, projectIds }),
      });
      created = true;
      forgetDraft(conversationId);
      const provider = choice.terminalProvider;
      if (agentMode && isTrackedTerminalProvider(provider))
        await api.updateChatSettings(conversationId, { provider, agentMode });
      await nativeTerminalApi.launch(
        conversationId,
        prompt ? { provider, prompt, messageId } : { provider },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        client.invalidateQueries({ queryKey: queryKeys.conversations }),
      ]);
      events.onLaunched?.();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The terminal could not start.');
      setBusy(false);
      events.onFailed?.(created);
    }
  };
  return { busy, error, start };
}
