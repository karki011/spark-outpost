import type { AgentRole } from '@spark-outpost/contracts';
import { greeting, type Voice } from '../spark/voice.ts';

export type VoiceRole = AgentRole | 'jev';
export type VoiceEvent = 'working' | 'checks' | 'checks_passed' | 'waiting' | 'done' | 'failed';

type Pools = Record<VoiceEvent, readonly string[]>;

const SHARED: Pools = {
  working: ['{who} is {fact}'],
  checks: ['{who} is running the checks: {fact}'],
  checks_passed: ['Checks passed: {fact}'],
  waiting: ['{who} needs your OK: {fact}', '{who} is waiting on you: {fact}'],
  done: ['{who} finished: {fact}'],
  failed: ['{who} hit a snag: {fact}'],
};

const ROLE_POOLS: Partial<Record<VoiceRole, Partial<Pools>>> = {
  scout: {
    working: ['{who} is {fact}', '{who} is curious, {fact}', '{who} is {fact}, taking notes'],
    done: ['{who} found it: {fact}', '{who} finished reading: {fact}'],
  },
  builder: {
    working: ['{who} is {fact}', '{who} is busy {fact}', '{who} is on it, {fact}'],
    checks: ['{who} is running the checks: {fact}', 'Fingers crossed, {who} runs {fact}'],
    done: ['{who} finished: {fact}', 'All built, {who} finished: {fact}'],
  },
  critic: {
    working: ['{who} is {fact}', '{who} is {fact}, carefully', '{who} squints at it, {fact}'],
    done: ['{who} has looked it over: {fact}', '{who} signed off: {fact}'],
  },
  architect: {
    working: ['{who} is {fact}', '{who} is sketching it out, {fact}'],
  },
  coordinator: {
    working: ['{who} is {fact}', '{who} is lining up the pieces, {fact}'],
  },
  integrator: {
    working: ['{who} is {fact}', '{who} is stitching it together, {fact}'],
  },
  jev: {
    working: ['Jev is {fact}', 'Jev is calmly {fact}'],
    waiting: ['Jev has a question: {fact}', 'Jev would like your call: {fact}'],
  },
};

const PLAIN: Pools = {
  working: ['{who}: {fact}'],
  checks: ['{who}: checks, {fact}'],
  checks_passed: ['Checks passed: {fact}'],
  waiting: ['{who} needs you: {fact}'],
  done: ['{who} finished: {fact}'],
  failed: ['{who} failed: {fact}'],
};

export function seedIndex(seed: string, size: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return size > 0 ? (hash >>> 0) % size : 0;
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export interface LineInput {
  role: VoiceRole | null;
  who: string;
  fact: string;
  seed: string;
}

export function crewLine(voice: Voice, event: VoiceEvent, input: LineInput): string {
  const pools =
    voice.personality === 'facts'
      ? PLAIN
      : { ...SHARED, ...(input.role ? ROLE_POOLS[input.role] : {}) };
  const pool = pools[event] ?? SHARED[event];
  const template = pool[seedIndex(`${input.seed}:${event}`, pool.length)]!;
  const fact = event === 'working' ? lowerFirst(input.fact.trim()) : input.fact.trim();
  return template.replace('{who}', input.who).replace('{fact}', fact.replace(/[….\s]+$/, ''));
}

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

export function doneLine(voice: Voice, detail: string, seed: string): string {
  if (voice.personality === 'facts' || !voice.name) return `Done: ${detail}.`;
  const pool = [`Nice one, ${voice.name}, ${detail}`, `All done, ${voice.name}: ${detail}`];
  return `${pool[seedIndex(seed, pool.length)]!}.`;
}
