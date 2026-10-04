const openers = new Map<string, () => void>();

export function onProjectMenuRequest(conversationId: string, open: () => void): () => void {
  openers.set(conversationId, open);
  return () => {
    if (openers.get(conversationId) === open) openers.delete(conversationId);
  };
}

export function requestProjectMenu(conversationId: string): void {
  openers.get(conversationId)?.();
}
