import { useEffect, useState } from 'react';

const openers = new Map<string, () => void>();

function onToolsRequest(conversationId: string, open: () => void): () => void {
  openers.set(conversationId, open);
  return () => {
    if (openers.get(conversationId) === open) openers.delete(conversationId);
  };
}

export function requestTools(conversationId: string): void {
  openers.get(conversationId)?.();
}

export function useToolsPanel(conversationId: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => onToolsRequest(conversationId, () => setOpen(true)), [conversationId]);
  return [open, setOpen];
}
