import type { Personality } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';

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

export function quietToday({ personality }: Voice): string {
  if (personality === 'playful') return 'Nothing else on the go today. A blank page, all yours.';
  if (personality === 'facts') return 'No other chats today.';
  return 'Nothing else on the go today. A fresh start.';
}

export function nothingFlagged({ personality, name }: Voice): string {
  if (personality === 'playful') return `Nothing is flagged${name ? `, ${name}` : ''}. Nice.`;
  if (personality === 'facts') return 'Nothing flagged';
  return 'Nothing is flagged';
}

export function briefOffLine({ personality }: Voice): string {
  if (personality === 'playful') return 'The brief is napping. Rules still sort the list below.';
  if (personality === 'facts') return 'Brief off. Rules sort the list.';
  return 'The brief is off. Rules still sort the list below.';
}

export function mapIntro({ personality }: Voice): string {
  if (personality === 'playful')
    return 'Spark turns each project into a sky of little constellations, so you can spot what’s core, what’s shared, and what a chat touched.';
  if (personality === 'facts')
    return 'Each project is mapped into areas: core, shared and feature, plus what a chat changed.';
  return 'Spark maps each project into areas so you can see what’s core, what’s shared, and what a chat touched.';
}

export const PERSONALITY_HINTS: Record<Personality, string> = {
  playful: 'Warm, a little humour, celebrates your wins.',
  friendly: 'Warm and to the point.',
  facts: 'Short answers, no small talk.',
};

export function sparkMood(personality: Personality): ScoutMood {
  if (personality === 'playful') return 'happy';
  if (personality === 'facts') return 'working';
  return null;
}
