import type { NativeTerminalSession } from '@spark-outpost/contracts';

const DISMISSED_KEY = 'spark-outpost.terminal.restart-notice';

type Readopted = NonNullable<NativeTerminalSession['readopted']>;

export function restartNoticeText(readopted: Readopted, time: (at: Date) => string): string {
  const kept = `Spark restarted at ${time(new Date(readopted.at))}. This session kept running.`;
  return readopted.stepsComplete
    ? kept
    : `${kept} Steps from while Spark was closed are not listed.`;
}

export function noticeKey(sessionId: string, readopted: Readopted): string {
  return `${sessionId}:${readopted.at}`;
}

export function isDismissed(key: string, storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(DISMISSED_KEY) === key;
  } catch {
    return false;
  }
}

export function dismiss(key: string, storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(DISMISSED_KEY, key);
  } catch {
    return;
  }
}
