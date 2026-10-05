import {
  AUTO_CONTINUE_CHOICES,
  AUTO_CONTINUE_CUSTOM_MIN_SECONDS,
  AUTO_CONTINUE_MAX_SECONDS,
} from '@spark-outpost/contracts';

export const CUSTOM_WAIT_ID = 'custom';
export const NEVER_WAIT_ID = 'never';

export const WAIT_RANGE_HINT = `Enter a whole number of seconds from ${AUTO_CONTINUE_CUSTOM_MIN_SECONDS} to ${AUTO_CONTINUE_MAX_SECONDS}.`;

export function waitLabel(seconds: number | null): string {
  if (seconds === null) return 'Never';
  return seconds >= 120 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
}

export function waitChoiceId(seconds: number | null): string {
  if (seconds === null) return NEVER_WAIT_ID;
  return AUTO_CONTINUE_CHOICES.includes(seconds) ? String(seconds) : CUSTOM_WAIT_ID;
}

export const WAIT_OPTIONS = [
  ...AUTO_CONTINUE_CHOICES.map((seconds) => ({
    id: waitChoiceId(seconds),
    label: waitLabel(seconds),
  })),
  { id: CUSTOM_WAIT_ID, label: 'Custom' },
];

export function presetSeconds(id: string): number | null | undefined {
  return AUTO_CONTINUE_CHOICES.find((seconds) => waitChoiceId(seconds) === id);
}

export function parsedWait(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  const inRange =
    seconds >= AUTO_CONTINUE_CUSTOM_MIN_SECONDS && seconds <= AUTO_CONTINUE_MAX_SECONDS;
  return inRange ? seconds : null;
}

export function waitHint(seconds: number | null): string {
  if (seconds === null) return 'Spark waits for your answer.';
  return `After ${waitLabel(seconds)}, Spark goes with its best guess or the safe option.`;
}
