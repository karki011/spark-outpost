export const WAITING_TO_START = 'Waiting to start';

export function waitingToStart(ahead: number | undefined): string {
  return ahead ? `${WAITING_TO_START} · ${ahead} ahead` : WAITING_TO_START;
}
