import type { ScoutMood } from '../brand/BlobScout.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import type { IslandView, Moment, SessionState } from './island-model.ts';

export interface MoodContext {
  waiting: number;
  hour: number;
  idleMinutes: number;
  running: number;
  moment: Moment | null;
  failed: boolean;
}

export const SLEEPY_IDLE_MINUTES = 45;

export function isSleepyTime(hour: number, idleMinutes: number): boolean {
  return hour >= 23 || hour < 5 || idleMinutes >= SLEEPY_IDLE_MINUTES;
}

export function scoutMoodFor(view: IslandView, context: MoodContext): ScoutMood {
  switch (view.kind) {
    case 'card':
    case 'nudge':
      return 'alert';
    case 'note':
    case 'panel':
      return null;
    case 'peek':
      if (context.waiting > 0) return 'alert';
      if (context.moment) return context.moment.kind === 'done' ? 'happy' : 'sad';
      if (context.running > 0) return 'working';
      if (context.failed) return 'sad';
      return isSleepyTime(context.hour, context.idleMinutes) ? 'sleep' : null;
  }
}

export type Quirk =
  'focused' | 'nervous' | 'relieved' | 'tilt' | 'peer' | 'bounce' | 'squint' | 'calm';

const CHECK_STEP =
  /\b(tests?|checks?|vitest|jest|lint|tsc|typecheck|pytest|pnpm (test|check)|npm test)\b/i;

export function isCheckStep(step: string | null | undefined): boolean {
  return CHECK_STEP.test(step ?? '');
}

export interface QuirkInput {
  role: string | null;
  state: SessionState;
  step: string | null;
  checksPassed: boolean;
}

export function crewQuirk(input: QuirkInput): Quirk {
  if (input.state === 'waiting') return 'tilt';
  if (input.checksPassed) return 'relieved';
  if (input.state === 'working' && isCheckStep(input.step)) return 'nervous';
  if (input.role === 'scout') return 'peer';
  if (input.role === 'critic') return 'squint';
  if (input.role === 'builder') return input.state === 'working' ? 'focused' : 'bounce';
  if (input.role === 'jev' || input.role === 'architect' || input.role === 'coordinator') {
    return 'calm';
  }
  return input.state === 'working' ? 'bounce' : 'calm';
}

const EXPRESSIONS: Record<SessionState, BlobExpression> = {
  working: 'thinking',
  waiting: 'unsure',
  done: 'happy',
  failed: 'sad',
  idle: 'idle',
};

export function sessionExpression(state: SessionState, sleepy: boolean): BlobExpression {
  if (state === 'idle' && sleepy) return 'sleepy';
  return EXPRESSIONS[state];
}

export const SESSION_COLORS = [
  '--c-claude',
  '--c-codex',
  '--c-zai',
  '--c-jev',
  '--accent',
] as const;

export function sessionColor(seedIndexOf: (size: number) => number): string {
  return `var(${SESSION_COLORS[seedIndexOf(SESSION_COLORS.length)]})`;
}
