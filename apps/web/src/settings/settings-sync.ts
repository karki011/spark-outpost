import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { followSavedTheme } from '../theme/theme.ts';

const CHANNEL = 'spark-outpost.settings';

type SettingsNews = 'changed' | 'reset';

export function announceSettings(news: SettingsNews): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(news);
  channel.close();
}

export function useAnnounceSettingChanges(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          announceSettings('changed');
        }
      }),
    [queryClient],
  );
}

export function useFollowSettingsWindow(): void {
  const queryClient = useQueryClient();
  useEffect(() => followSavedTheme(), []);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'reset') window.location.reload();
      if (event.data === 'changed') void queryClient.invalidateQueries();
    };
    return () => channel.close();
  }, [queryClient]);
}
