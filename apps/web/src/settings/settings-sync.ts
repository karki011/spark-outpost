import { useEffect } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

const CHANNEL = 'spark-outpost.settings';
export const SAVE_SETTLE_MS = 5_000;

type SettingsNews = 'changed' | 'reset' | { changed: QueryKey };

export function announceSettings(news: SettingsNews): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(news);
  channel.close();
}

function changedKey(news: unknown): QueryKey | null {
  if (typeof news !== 'object' || news === null || !('changed' in news)) return null;
  return Array.isArray(news.changed) ? news.changed : null;
}

export function announceSettingChanges(client: QueryClient, now = Date.now): () => void {
  let saving = 0;
  let savedAt = -Infinity;
  const known = new Map<string, unknown>();
  for (const query of client.getQueryCache().getAll()) {
    if (query.state.data !== undefined) known.set(query.queryHash, query.state.data);
  }
  const duringSave = () => saving > 0 || now() - savedAt < SAVE_SETTLE_MS;

  const stopMutations = client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const action = event.action.type;
    if (action === 'pending') saving += 1;
    if (action !== 'success' && action !== 'error') return;
    saving = Math.max(0, saving - 1);
    savedAt = now();
    if (action === 'success') announceSettings('changed');
  });
  const stopQueries = client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') known.delete(event.query.queryHash);
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const { queryHash, queryKey, state } = event.query;
    const loadedBefore = known.has(queryHash);
    const changed = known.get(queryHash) !== state.data;
    known.set(queryHash, state.data);
    if (loadedBefore && changed && duringSave()) announceSettings({ changed: queryKey });
  });
  return () => {
    stopMutations();
    stopQueries();
  };
}

export function followSettingsWindow(client: QueryClient): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  let waiting = false;
  const refreshAll = () => {
    waiting = false;
    void client.invalidateQueries();
  };
  const onFocus = () => {
    if (waiting) refreshAll();
  };
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const key = changedKey(event.data);
    if (key) void client.invalidateQueries({ queryKey: key });
    if (event.data === 'reset') window.location.reload();
    if (event.data !== 'changed') return;
    if (document.hasFocus()) refreshAll();
    else waiting = true;
  };
  window.addEventListener('focus', onFocus);
  return () => {
    window.removeEventListener('focus', onFocus);
    channel.close();
  };
}

export function useAnnounceSettingChanges(): void {
  const queryClient = useQueryClient();
  useEffect(() => announceSettingChanges(queryClient), [queryClient]);
}

export function useFollowSettingsWindow(): void {
  const queryClient = useQueryClient();
  useEffect(() => followSettingsWindow(queryClient), [queryClient]);
}
