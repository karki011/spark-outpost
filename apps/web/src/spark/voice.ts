import type { Personality } from '@spark-outpost/contracts';

export interface Voice {
  personality: Personality;
  name: string;
}

const TIME_OF_DAY = ['Working late', 'Good morning', 'Good afternoon', 'Good evening'];
const PLAYFUL_TIME_OF_DAY = ['Night owl mode', 'Morning', 'Afternoon', 'Evening'];

function daySlot(hour: number): number {
  if (hour < 5) return 0;
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
}

export function timeOfDay(hour: number): string {
  return TIME_OF_DAY[daySlot(hour)]!;
}

export function greeting({ personality, name }: Voice, hour: number): string {
  if (personality === 'facts') return name ? `${timeOfDay(hour)}, ${name}.` : `${timeOfDay(hour)}.`;
  if (personality === 'playful')
    return `${PLAYFUL_TIME_OF_DAY[daySlot(hour)]}, ${name || 'friend'}!`;
  return `${timeOfDay(hour)}, ${name || 'there'}`;
}

export function hello({ personality, name }: Voice): string {
  const who = name || 'there';
  if (personality === 'playful') return `Hey ${who}! 👋 Ready when you are.`;
  if (personality === 'facts') return `Hi ${who}.`;
  return `Hi ${who} 👋`;
}

export function quietSummary({ personality }: Voice): string {
  if (personality === 'playful') return 'All quiet. What shall we make next?';
  if (personality === 'facts') return 'Nothing running.';
  return 'All quiet. Start something new below.';
}

export function quietCard({ personality, name }: Voice): string {
  if (personality === 'playful') {
    return `Nothing needs you${name ? `, ${name}` : ''}, and no agents are running. Enjoy the calm.`;
  }
  if (personality === 'facts') return 'Nothing needs you. No agents running.';
  return 'All quiet. Nothing needs you and no agents are running.';
}

export const PERSONALITY_HINTS: Record<Personality, string> = {
  playful: 'Warm, a little humour, celebrates your wins.',
  friendly: 'Warm and to the point.',
  facts: 'Short answers, no small talk.',
};
