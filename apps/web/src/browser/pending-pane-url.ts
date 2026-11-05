const pending = new Map<string, string>();
const listeners = new Set<() => void>();

export function queuePaneUrl(chatId: string, url: string): void {
  pending.set(chatId, url);
  listeners.forEach((listener) => listener());
}

export function takePaneUrl(chatId: string): string | null {
  const url = pending.get(chatId) ?? null;
  pending.delete(chatId);
  return url;
}

export function onPaneUrl(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
