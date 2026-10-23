import { API_TOKEN_HEADER, type BrowserHistoryEvent } from '@spark-outpost/contracts';

const TIMEOUT_MS = 5_000;

export function historyPoster(origin: string, token: string, fetchImpl: typeof fetch = fetch) {
  return (event: BrowserHistoryEvent): void => {
    void fetchImpl(`${origin}/api/browser-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [API_TOKEN_HEADER]: token },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  };
}
