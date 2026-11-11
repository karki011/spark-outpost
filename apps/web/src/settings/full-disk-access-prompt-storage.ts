const PROMPT_KEY = 'spark-outpost.full-disk-access-prompt';
const SILENCED = 'silenced';
const SNOOZED_PREFIX = 'snoozed:';

const currentTime = () => Date.now();

export const SNOOZE_MS = 2 * 60 * 60 * 1000;

export type PromptHold = 'forever' | number | null;

export function readPromptHold(now: () => number = currentTime): PromptHold {
  try {
    const stored = localStorage.getItem(PROMPT_KEY);
    if (stored === SILENCED) return 'forever';
    if (stored?.startsWith(SNOOZED_PREFIX)) {
      const until = Number(stored.slice(SNOOZED_PREFIX.length));
      return Number.isFinite(until) && until > now() ? until : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function silencePrompt(): void {
  try {
    localStorage.setItem(PROMPT_KEY, SILENCED);
  } catch {
    return;
  }
}

export function snoozePrompt(now: () => number = currentTime): number {
  const until = now() + SNOOZE_MS;
  try {
    localStorage.setItem(PROMPT_KEY, `${SNOOZED_PREFIX}${until}`);
  } catch {
    return until;
  }
  return until;
}
