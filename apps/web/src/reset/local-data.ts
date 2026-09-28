const APP_KEY_PREFIX = 'spark-';
const NOTICE_KEY = 'spark-outpost.reset-notice';

function clearAppKeys(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) if (key?.startsWith(APP_KEY_PREFIX)) storage.removeItem(key);
}

export function clearLocalAppData(): void {
  try {
    clearAppKeys(localStorage);
    clearAppKeys(sessionStorage);
  } catch {
    return;
  }
}

export function saveResetNotice(problems: readonly string[]): void {
  if (problems.length === 0) return;
  try {
    sessionStorage.setItem(NOTICE_KEY, JSON.stringify(problems));
  } catch {
    return;
  }
}

export function takeResetNotice(): string[] {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
