import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { slackApi, slackKeys } from './slack-api.ts';

const HEARTBEAT_MS = 30_000;
const CLIENT_ID = crypto.randomUUID();

const focusedNow = () => document.visibilityState === 'visible' && document.hasFocus();

export function useSlackPresence(remote: boolean): void {
  const status = useQuery({ queryKey: slackKeys.status, queryFn: slackApi.status });
  const wanted = remote || status.data?.connection?.settings.quietWhenFocused === true;

  useEffect(() => {
    if (!wanted) return;
    let last: boolean | null = null;
    const report = (force: boolean) => {
      const focused = focusedNow();
      if (!force && focused === last) return;
      last = focused;
      void slackApi.presence(focused, CLIENT_ID).catch(() => undefined);
    };
    const changed = () => report(false);
    const beat = setInterval(() => {
      if (focusedNow()) report(true);
    }, HEARTBEAT_MS);
    report(true);
    window.addEventListener('focus', changed);
    window.addEventListener('blur', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      clearInterval(beat);
      window.removeEventListener('focus', changed);
      window.removeEventListener('blur', changed);
      document.removeEventListener('visibilitychange', changed);
    };
  }, [wanted]);
}
