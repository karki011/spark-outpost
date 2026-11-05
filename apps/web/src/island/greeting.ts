import { greeting, type Voice } from '../spark/voice.ts';

export type GreetingMoment = 'first_open' | 'welcome_back';

export const WELCOME_BACK_MS = 2 * 60 * 60_000;

export function greetingDue(
  lastSeen: number | null,
  lastGreetedDay: string | null,
  now: Date,
): GreetingMoment | null {
  if (lastGreetedDay !== dayKey(now)) return 'first_open';
  if (lastSeen !== null && now.getTime() - lastSeen >= WELCOME_BACK_MS) return 'welcome_back';
  return null;
}

export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function greetingLine(voice: Voice, moment: GreetingMoment, now: Date): string {
  if (moment === 'first_open') return greeting(voice, now.getHours()).replace(/[.!]?$/, '!');
  if (voice.personality === 'facts')
    return voice.name ? `Welcome back, ${voice.name}.` : 'Welcome back.';
  return voice.name ? `Welcome back, ${voice.name}!` : 'Welcome back!';
}
